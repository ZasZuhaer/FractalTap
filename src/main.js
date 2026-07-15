// Classic script (see index.html): relies on the modules below having
// already run and populated window.App, rather than ES import/export,
// so the app also works when the page is opened directly via file://.
const { createWoodTexture } = window.App.woodTexture;
const { createPointerController } = window.App.pointerController;
const settings = window.App.settings;
const history = window.App.history;

/** The fractal engine currently selected in the drawer (falls back to
 * Lichtenberg Burn if the setting is ever pointed at an unknown id). */
function activeEngine() {
  return window.App.fractalEngines[settings.fractalType] || window.App.fractalEngines.lichtenberg;
}

const woodCanvas = document.getElementById('wood-canvas');
const burnCanvas = document.getElementById('burn-canvas');
const glowCanvas = document.getElementById('glow-canvas');
const woodCtx = woodCanvas.getContext('2d');
const burnCtx = burnCanvas.getContext('2d', { alpha: true });
const glowCtx = glowCanvas.getContext('2d', { alpha: true });

history.attach(burnCtx);

const MAX_DPR = 2.5; // cap device pixel ratio so 4K/8K panels stay smooth
const woodSeed = Date.now() & 0xffffffff;

let dpr = 1;

function resizeCanvases(preserveBurnMarks) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  // Wood layer: fully regenerated (seeded, so it looks stable across resizes).
  woodCanvas.width = Math.round(w * dpr);
  woodCanvas.height = Math.round(h * dpr);
  const texture = createWoodTexture(w, h, woodSeed);
  woodCtx.setTransform(1, 0, 0, 1, 0, 0);
  woodCtx.clearRect(0, 0, woodCanvas.width, woodCanvas.height);
  woodCtx.drawImage(texture, 0, 0, w, h, 0, 0, woodCanvas.width, woodCanvas.height);

  // Burn layer: content must persist permanently, so snapshot the
  // existing bitmap and stretch it into the newly sized canvas.
  let snapshot = null;
  if (preserveBurnMarks && burnCanvas.width > 0 && burnCanvas.height > 0) {
    snapshot = document.createElement('canvas');
    snapshot.width = burnCanvas.width;
    snapshot.height = burnCanvas.height;
    snapshot.getContext('2d').drawImage(burnCanvas, 0, 0);
  }

  burnCanvas.width = Math.round(w * dpr);
  burnCanvas.height = Math.round(h * dpr);
  burnCtx.setTransform(1, 0, 0, 1, 0, 0);
  if (snapshot) {
    burnCtx.drawImage(
      snapshot,
      0, 0, snapshot.width, snapshot.height,
      0, 0, burnCanvas.width, burnCanvas.height
    );
  }
  // Draw in CSS-pixel coordinates from here on, matching pointer coords.
  burnCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Glow layer is fully transient (cleared every animation frame), so
  // it just needs to match size — no content to preserve.
  glowCanvas.width = Math.round(w * dpr);
  glowCanvas.height = Math.round(h * dpr);
  glowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Resizing changes canvas dimensions, which invalidates any stored
  // undo/redo snapshots; start a fresh baseline from what's on screen
  // now (this is the one case where undo history is intentionally lost).
  history.reset();
}

resizeCanvases(false);

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => resizeCanvases(true), 150);
});

// One shared animation loop drives every simultaneously-held growth
// session. Each entry remembers which engine created it, so stepping
// and drawing stay consistent even if the selected fractal design
// changes between one hold and the next.
const sessions = new Map(); // pointerId -> { session, engine }
let rafId = null;
let lastTime = 0;

function clearGlow() {
  glowCtx.save();
  glowCtx.setTransform(1, 0, 0, 1, 0, 0);
  glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
  glowCtx.restore();
}

function loop(timestamp) {
  if (sessions.size === 0) {
    rafId = null;
    return;
  }
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  for (const { session, engine } of sessions.values()) {
    if (session.burning === 'constant') {
      window.App.burning.updateBudgets(session, dt);
      window.App.burning.updateGenBoost(session);
    }
    engine.stepGrowthSession(burnCtx, session, dt);
    if (session.burning === 'constant') {
      window.App.burning.maybeThicken(burnCtx, session, engine);
    }
  }

  // Live electric glow at each still-growing tip; redrawn from scratch
  // every frame so it vanishes the instant a hold ends.
  clearGlow();
  for (const { session, engine } of sessions.values()) {
    for (const tip of session.tips) {
      for (const pos of engine.getTipWorldPositions(session, tip)) {
        engine.drawTipGlow(glowCtx, pos.x, pos.y, tip.width);
      }
    }
  }

  rafId = requestAnimationFrame(loop);
}

function ensureLoopRunning() {
  if (rafId === null) {
    lastTime = 0;
    rafId = requestAnimationFrame(loop);
  }
}

/** Freezes one growth session permanently and records it as an
 * undoable action. Shared by a normal pointer release and by the
 * drawer forcing any in-progress growth to finish (e.g. on open). */
function finishSession(id) {
  const entry = sessions.get(id);
  if (!entry) return;
  sessions.delete(id);

  // One last, unbatched thickening pass so the frozen result reflects
  // the exact moment of release rather than the last periodic tick.
  if (entry.session.burning === 'constant') {
    window.App.burning.finalizeThickening(burnCtx, entry.session, entry.engine);
  }

  history.commit();
  if (sessions.size === 0) {
    // The loop is about to stop and won't get another chance to
    // clear the transient glow layer, so do it now.
    clearGlow();
  }
  if (window.App.drawer) window.App.drawer.refreshHistoryButtons();
}

function endAllSessions() {
  for (const id of Array.from(sessions.keys())) {
    finishSession(id);
  }
}

const pointerController = createPointerController({
  onTap(x, y) {
    if (window.App.drawer && window.App.drawer.isOpen()) return;
    activeEngine().drawBurnDot(burnCtx, x, y);
    history.commit();
    if (window.App.drawer) window.App.drawer.refreshHistoryButtons();
  },
  onHoldStart(id, x, y) {
    if (window.App.drawer && window.App.drawer.isOpen()) return;
    const engine = activeEngine();
    const session = engine.createGrowthSession(burnCtx, x, y, {
      branchCount: settings.branches,
      symmetric: settings.symmetry,
    });
    window.App.burning.prepareSession(session, settings.burning);
    sessions.set(id, { session, engine });
    ensureLoopRunning();
    if (window.App.drawer) window.App.drawer.refreshHistoryButtons();
  },
  onHoldEnd(id) {
    finishSession(id);
  },
});

pointerController.attach(burnCanvas);

/** Wipes every burn mark back to bare wood. Recorded as its own
 * undoable action, so an accidental clear is a single Undo away. */
function clearBoard() {
  burnCtx.save();
  burnCtx.setTransform(1, 0, 0, 1, 0, 0);
  burnCtx.clearRect(0, 0, burnCanvas.width, burnCanvas.height);
  burnCtx.restore();
  history.commit();
  if (window.App.drawer) window.App.drawer.refreshHistoryButtons();
}

window.App.growth = {
  isActive: () => sessions.size > 0,
  endAllSessions,
};

window.App.board = {
  clear: clearBoard,
};
