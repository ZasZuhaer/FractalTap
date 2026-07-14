// Classic script (see index.html): relies on the modules below having
// already run and populated window.App, rather than ES import/export,
// so the app also works when the page is opened directly via file://.
const { createWoodTexture } = window.App.woodTexture;
const { createPointerController } = window.App.pointerController;
const { drawBurnDot, createGrowthSession, stepGrowthSession, drawTipGlow } = window.App.lichtenberg;

const woodCanvas = document.getElementById('wood-canvas');
const burnCanvas = document.getElementById('burn-canvas');
const glowCanvas = document.getElementById('glow-canvas');
const woodCtx = woodCanvas.getContext('2d');
const burnCtx = burnCanvas.getContext('2d', { alpha: true });
const glowCtx = glowCanvas.getContext('2d', { alpha: true });

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
}

resizeCanvases(false);

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => resizeCanvases(true), 150);
});

// One shared animation loop drives every simultaneously-held growth session.
const sessions = new Map(); // pointerId -> growth session
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

  for (const session of sessions.values()) {
    stepGrowthSession(burnCtx, session, dt);
  }

  // Live electric glow at each still-growing tip; redrawn from scratch
  // every frame so it vanishes the instant a hold ends.
  clearGlow();
  for (const session of sessions.values()) {
    for (const tip of session.tips) {
      drawTipGlow(glowCtx, tip.x, tip.y, tip.width);
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

const pointerController = createPointerController({
  onTap(x, y) {
    drawBurnDot(burnCtx, x, y);
  },
  onHoldStart(id, x, y) {
    sessions.set(id, createGrowthSession(burnCtx, x, y));
    ensureLoopRunning();
  },
  onHoldEnd(id) {
    // Growth simply stops advancing; whatever was drawn stays baked
    // into the burn canvas permanently.
    sessions.delete(id);
    if (sessions.size === 0) {
      // The loop is about to stop and won't get another chance to
      // clear the transient glow layer, so do it now.
      clearGlow();
    }
  },
});

pointerController.attach(burnCanvas);
