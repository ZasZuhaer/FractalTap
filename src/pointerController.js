(function (App) {
  const HOLD_DELAY_MS = 180;
  const TAP_MOVE_TOLERANCE = 12; // px

/**
 * Unified tap/hold gesture detection built on the Pointer Events API
 * so mouse, touch and pen all share one code path, including
 * simultaneous multi-touch holds.
 */
function createPointerController({ onTap, onHoldStart, onHoldEnd }) {
  const active = new Map(); // pointerId -> tracking record

  function handleDown(e) {
    e.preventDefault();
    const id = e.pointerId;
    const record = {
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      holding: false,
      timer: null,
    };
    record.timer = setTimeout(() => {
      record.holding = true;
      onHoldStart(id, record.startX, record.startY);
    }, HOLD_DELAY_MS);
    active.set(id, record);

    if (e.target.setPointerCapture) {
      try {
        e.target.setPointerCapture(id);
      } catch (_) {
        // Capture can fail on some browsers/inputs; safe to ignore.
      }
    }
  }

  function handleMove(e) {
    const record = active.get(e.pointerId);
    if (!record) return;
    record.x = e.clientX;
    record.y = e.clientY;
  }

  function endGesture(id) {
    const record = active.get(id);
    if (!record) return;
    clearTimeout(record.timer);

    if (record.holding) {
      onHoldEnd(id);
    } else {
      const dx = record.x - record.startX;
      const dy = record.y - record.startY;
      if (Math.hypot(dx, dy) < TAP_MOVE_TOLERANCE) {
        onTap(record.startX, record.startY);
      }
    }
    active.delete(id);
  }

  function handleUp(e) {
    endGesture(e.pointerId);
  }

  function handleCancel(e) {
    endGesture(e.pointerId);
  }

  function attach(el) {
    el.addEventListener('pointerdown', handleDown, { passive: false });
    el.addEventListener('pointermove', handleMove, { passive: true });
    el.addEventListener('pointerup', handleUp, { passive: true });
    el.addEventListener('pointercancel', handleCancel, { passive: true });
    el.addEventListener('pointerleave', handleCancel, { passive: true });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  return { attach };
}

  App.pointerController = { createPointerController };
})(window.App = window.App || {});
