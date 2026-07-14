(function (App) {
  const { TAU, clamp } = App.utils;

// Tunable growth parameters. Kept together so the "feel" of the
// fractal can be adjusted from one place.
const MAX_SEGMENTS = 6000;
const MAX_ACTIVE_TIPS = 42;
const MIN_ACTIVE_TIPS = 2;
const FORK_CHANCE_PER_SEC = 1.5;
const RESPAWN_CHANCE_PER_SEC = 2.4;
const INITIAL_BRANCHES = 4;

// Two-tier steering: a small continuous wobble plus infrequent sharp
// "kinks" is what makes the path read as jagged lightning rather than
// a smooth curve.
const JITTER_RATE = 1.1; // rad/sec of continuous wobble
const KINK_CHANCE_PER_SEC = 3.0;
const KINK_MIN = 0.16; // ~9deg
const KINK_MAX = 0.55; // ~31deg

// Small fractal offshoots stitched onto the main channel for texture,
// mirroring the fine barbs seen on real Lichtenberg burns.
const BARB_CHANCE = 0.16;

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function sign() {
  return Math.random() < 0.5 ? -1 : 1;
}

/** A single growing branch tip. */
function makeTip(x, y, angle, energy, width, speed) {
  return { x, y, angle, energy, maxEnergy: energy, width, speed };
}

function makeChildTip(parent) {
  const angle = parent.angle + sign() * randRange(0.3, 0.85);
  const energy = parent.energy * randRange(0.4, 0.68);
  return makeTip(
    parent.x,
    parent.y,
    angle,
    energy,
    parent.width * 0.66,
    parent.speed * randRange(0.85, 1.08)
  );
}

/** Re-seeds growth outward from an existing burned point, biased away
 * from the strike origin so long holds keep radiating rather than
 * clustering back on themselves. */
function makeSpawnTip(x, y, originX, originY) {
  const outward = Math.atan2(y - originY, x - originX);
  const angle = Number.isFinite(outward) ? outward + randRange(-0.5, 0.5) : Math.random() * TAU;
  return makeTip(x, y, angle, randRange(80, 170), randRange(1.6, 2.4), randRange(100, 170));
}

/**
 * Draws a single scorched segment: a soft brown halo, a mid char
 * tone, and a near-black core. All three passes are drawn once and
 * baked permanently into the (never-cleared) burn canvas.
 */
function drawSegment(ctx, x0, y0, x1, y1, widthPx) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = 'rgba(110,48,18,0.16)';
  ctx.lineWidth = widthPx * 3.4;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(42,19,9,0.5)';
  ctx.lineWidth = widthPx * 1.8;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(12,7,5,0.92)';
  ctx.lineWidth = Math.max(0.6, widthPx);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Rotates a point around the local origin, then places it in world
 * space — the one operation that turns a single canonical branch into
 * an evenly-spaced radial copy. */
function rotateAndPlace(lx, ly, rotation, worldX, worldY) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: worldX + lx * cos - ly * sin,
    y: worldY + lx * sin + ly * cos,
  };
}

/**
 * Draws one segment, replicated across every symmetric branch when the
 * session is in symmetric mode. Non-symmetric sessions draw their
 * (already world-space) coordinates exactly once, unchanged.
 */
function drawReplicatedSegment(ctx, session, x0, y0, x1, y1, widthPx) {
  if (!session.symmetric) {
    drawSegment(ctx, x0, y0, x1, y1, widthPx);
    return;
  }
  const n = session.branchCount;
  for (let i = 0; i < n; i++) {
    const rotation = session.rotationBase + (i / n) * TAU;
    const p0 = rotateAndPlace(x0, y0, rotation, session.worldOriginX, session.worldOriginY);
    const p1 = rotateAndPlace(x1, y1, rotation, session.worldOriginX, session.worldOriginY);
    drawSegment(ctx, p0.x, p0.y, p1.x, p1.y, widthPx);
  }
}

/** Computes a short, thin static offshoot's endpoint — pure geometry,
 * randomized once regardless of how many symmetric copies will be
 * drawn from it, so every rotated copy gets the identical barb. */
function computeBarb(x, y, baseAngle, widthPx) {
  const angle = baseAngle + sign() * randRange(0.9, 1.7);
  const len = randRange(4, 14) * clamp(widthPx / 2.4, 0.4, 1.3);
  return {
    x1: x + Math.cos(angle) * len,
    y1: y + Math.sin(angle) * len,
    width: Math.max(0.5, widthPx * 0.42),
  };
}

/** A small charred blotch for a plain tap/click. */
function drawBurnDot(ctx, x, y) {
  const r = randRange(3, 6);

  const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 3.5);
  halo.addColorStop(0, 'rgba(95,42,16,0.32)');
  halo.addColorStop(1, 'rgba(95,42,16,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.5, 0, TAU);
  ctx.fill();

  ctx.fillStyle = 'rgba(16,9,6,0.9)';
  ctx.beginPath();
  const pts = 8;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * TAU;
    const rr = r * (0.75 + Math.random() * 0.5);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/** A soft, transient electric glow — drawn on a cleared-every-frame
 * layer, never on the permanent burn canvas, so it disappears the
 * instant growth stops. */
function drawTipGlow(ctx, x, y, widthPx) {
  const r = widthPx * 3.2 + 3;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(255,214,140,0.55)');
  g.addColorStop(0.35, 'rgba(255,150,60,0.28)');
  g.addColorStop(1, 'rgba(255,150,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/** World-space position(s) a tip should currently be rendered at: one
 * position for a normal (independent) tip, or one per symmetric branch
 * for a canonical tip being mirrored radially. Used by callers that
 * need to draw something at a tip's *current* location every frame
 * (e.g. the live glow), outside the segment-drawing path above. */
function getTipWorldPositions(session, tip) {
  if (!session.symmetric) {
    return [{ x: tip.x, y: tip.y }];
  }
  const n = session.branchCount;
  const positions = [];
  for (let i = 0; i < n; i++) {
    const rotation = session.rotationBase + (i / n) * TAU;
    positions.push(rotateAndPlace(tip.x, tip.y, rotation, session.worldOriginX, session.worldOriginY));
  }
  return positions;
}

/**
 * Starts a new growth session at the contact point: burns an origin
 * mark and radiates a few initial tips outward.
 *
 * @param {object} [options]
 * @param {number} [options.branchCount] how many primary branches (1-8)
 * @param {boolean} [options.symmetric] when true, only ONE canonical
 *   branch is ever simulated (in local coordinates around the touch
 *   point); every draw call mirrors it at `branchCount` evenly-spaced
 *   rotations, so every branch — forks, kinks, barbs, timing, all of
 *   it — is a pixel-identical rotated copy. When false, each branch is
 *   simulated independently with its own randomized angle, giving the
 *   organic, non-repeating look.
 */
function createGrowthSession(ctx, x, y, options) {
  const opts = options || {};
  const branchCount = clamp(Math.round(opts.branchCount || INITIAL_BRANCHES), 1, 8);
  const symmetric = !!opts.symmetric;

  drawBurnDot(ctx, x, y);

  // Replicating draws N times multiplies rendering cost, so scale the
  // per-session growth budget down accordingly — the finished symmetric
  // figure ends up with roughly the same total segment/tip count as a
  // non-symmetric one, just arranged radially instead of independently.
  const maxSegments = symmetric ? Math.max(200, Math.round(MAX_SEGMENTS / branchCount)) : MAX_SEGMENTS;
  const maxActiveTips = symmetric ? Math.max(6, Math.round(MAX_ACTIVE_TIPS / branchCount)) : MAX_ACTIVE_TIPS;

  if (symmetric) {
    const tip = makeTip(0, 0, 0, randRange(220, 380), randRange(2.8, 3.8), randRange(130, 210));
    return {
      symmetric: true,
      branchCount,
      rotationBase: Math.random() * TAU,
      worldOriginX: x,
      worldOriginY: y,
      tips: [tip],
      burnedPoints: [{ x: 0, y: 0 }],
      segmentCount: 0,
      maxSegments,
      maxActiveTips,
    };
  }

  const tips = [];
  for (let i = 0; i < branchCount; i++) {
    const angle = Math.random() * TAU;
    tips.push(makeTip(x, y, angle, randRange(220, 380), randRange(2.8, 3.8), randRange(130, 210)));
  }

  return {
    symmetric: false,
    originX: x,
    originY: y,
    tips,
    burnedPoints: [{ x, y }],
    segmentCount: 0,
    maxSegments,
    maxActiveTips,
  };
}

/**
 * Advances one growth session by dt seconds, drawing newly grown
 * segments directly onto the (permanent) burn canvas. For a symmetric
 * session this steps the single canonical branch and draws every
 * segment/barb replicated at each rotation, keeping every branch a
 * perfect mirrored copy grown in lockstep.
 */
function stepGrowthSession(ctx, session, dt) {
  if (session.segmentCount >= session.maxSegments) return;

  const nextTips = [];

  for (const tip of session.tips) {
    if (tip.energy <= 0) continue;

    tip.angle += (Math.random() - 0.5) * JITTER_RATE * dt;
    if (Math.random() < KINK_CHANCE_PER_SEC * dt) {
      tip.angle += sign() * randRange(KINK_MIN, KINK_MAX);
    }

    const stepLen = tip.speed * dt;
    const nx = tip.x + Math.cos(tip.angle) * stepLen;
    const ny = tip.y + Math.sin(tip.angle) * stepLen;

    // Power-curve taper: stays close to full width for most of the
    // branch's life, then narrows quickly to a sharp point.
    const energyFrac = clamp(tip.energy / tip.maxEnergy, 0, 1);
    const widthPx = Math.max(0.5, tip.width * Math.pow(energyFrac, 1.15));
    drawReplicatedSegment(ctx, session, tip.x, tip.y, nx, ny, widthPx);
    session.segmentCount++;

    if (Math.random() < BARB_CHANCE) {
      const barb = computeBarb(nx, ny, tip.angle, widthPx);
      drawReplicatedSegment(ctx, session, nx, ny, barb.x1, barb.y1, barb.width);
    }

    if (session.segmentCount % 5 === 0) {
      session.burnedPoints.push({ x: nx, y: ny });
    }

    tip.x = nx;
    tip.y = ny;
    tip.energy -= stepLen;

    if (tip.energy > 0 && session.segmentCount < session.maxSegments) {
      const canFork =
        session.tips.length + nextTips.length < session.maxActiveTips &&
        Math.random() < FORK_CHANCE_PER_SEC * dt;
      if (canFork) {
        nextTips.push(makeChildTip(tip));
      }
      nextTips.push(tip);
    }
  }

  session.tips = nextTips;

  if (
    session.tips.length < MIN_ACTIVE_TIPS &&
    session.segmentCount < session.maxSegments &&
    session.burnedPoints.length > 0 &&
    Math.random() < RESPAWN_CHANCE_PER_SEC * dt
  ) {
    const p = session.burnedPoints[(Math.random() * session.burnedPoints.length) | 0];
    const originX = session.symmetric ? 0 : session.originX;
    const originY = session.symmetric ? 0 : session.originY;
    session.tips.push(makeSpawnTip(p.x, p.y, originX, originY));
  }
}

  App.lichtenberg = {
    drawBurnDot,
    createGrowthSession,
    stepGrowthSession,
    drawTipGlow,
    getTipWorldPositions,
  };
})(window.App = window.App || {});
