(function (App) {
  // Undo/redo for the burn layer, implemented as a capped stack of
  // full-canvas bitmap snapshots. Simple and robust: the burn canvas
  // is small in DOM terms and this avoids tracking a separate vector
  // model of every dot/branch ever drawn.
  const MAX_HISTORY = 25;

  let ctx = null;
  let states = [];
  let pointer = -1;

  function cloneCanvas(source) {
    const c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    c.getContext('2d').drawImage(source, 0, 0);
    return c;
  }

  /** Point history at the canvas it should snapshot/restore. */
  function attach(targetCtx) {
    ctx = targetCtx;
  }

  /** Establish a fresh baseline (e.g. current canvas is blank, or a
   * resize just invalidated old snapshot dimensions). Discards any
   * existing undo/redo stack. */
  function reset() {
    if (!ctx) return;
    states = [cloneCanvas(ctx.canvas)];
    pointer = 0;
  }

  /** Record the canvas's current pixels as a new committed action,
   * discarding any redo states beyond the current pointer. */
  function commit() {
    if (!ctx) return;
    states = states.slice(0, pointer + 1);
    states.push(cloneCanvas(ctx.canvas));
    pointer++;

    if (states.length > MAX_HISTORY) {
      const excess = states.length - MAX_HISTORY;
      states.splice(0, excess);
      pointer -= excess;
    }
  }

  function restoreCurrent() {
    const snapshot = states[pointer];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(snapshot, 0, 0);
    ctx.restore();
  }

  function undo() {
    if (pointer <= 0) return false;
    pointer--;
    restoreCurrent();
    return true;
  }

  function redo() {
    if (pointer >= states.length - 1) return false;
    pointer++;
    restoreCurrent();
    return true;
  }

  function canUndo() {
    return pointer > 0;
  }

  function canRedo() {
    return pointer < states.length - 1;
  }

  App.history = { attach, reset, commit, undo, redo, canUndo, canRedo };
})(window.App = window.App || {});
