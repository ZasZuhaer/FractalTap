(function (App) {
  const { TAU, clamp } = App.utils;

// Electric Fern: a true recursive fractal fern. Every branch at every
// level — main branch, sub-branch, sub-sub-branch, and so on — is a
// live-growing tip steered with the same jagged, lightning-like
// wobble+kink technique as Lichtenberg Burn (never a straight line).
// Along its length, at fairly regular intervals, a branch spawns
// smaller child branches alternating left/right at a consistent angle
// — the set of children off one parent is what reads as "a fern",
// with the parent as the rachis and the children as its pinnae. Each
// child is itself built exactly the same way, recursively, so a group
// of sub-branches looks like a small fern, a group of sub-sub-branches
// looks like an even smaller fern, and so on — self-similar at every
// scale. Deeper generations only start forking in once the hold has
// lasted long enough (session.maxUnlockedGeneration), so the fern
// visibly grows more intricate the longer the pointer is held.
const MAX_SEGMENTS = 9000;
const MAX_ACTIVE_TIPS = 110;
const INITIAL_BRANCHES = 4;

// Steering + rendering tuned to look like real lightning (see the
// reference photo): short straight runs that hard-flip left/right at
// each kink, so the path reads as a genuine zigzag around its growth
// direction rather than a smoothly flowing wobble or a one-sided curl.
// `trendAngle` is the branch's actual growth direction; the drawn
// heading (`angle`) is trendAngle plus a zigzag offset that flips sign
// — never repeats the same side twice — at every kink, and holds
// constant (dead straight, see drawSegment's unsmoothed vertices)
// until the next kink.
//
// Both the fine zigzag AND the branch's overall course are scheduled
// by DISTANCE travelled, not a per-frame probability: a probability
// roll has a long exponential tail, so even at a high average rate a
// tip occasionally "gets lucky" and runs straight for a noticeably
// long stretch. Guaranteeing the next event within a min..max px
// window instead caps every straight run at a short length and keeps
// consecutive tooth lengths visibly irregular (the window is wide, not
// a near-fixed average) — no exceptions.
//
// Two scales of turning, layered, are what stop the path from reading
// as "one obvious straight line with small jitter on it":
//  - KINK_* is the fine zigzag teeth (every few px).
//  - COURSE_* occasionally reaches into trendAngle itself and bends
//    the branch's actual heading by a large, random-signed amount —
//    like a real lightning channel's stepped leader periodically
//    changing overall direction — so the "average line" a branch
//    follows visibly wanders instead of beelining from origin to tip.
const KINK_DIST_MIN = 3; // px of travel before the next guaranteed flip
const KINK_DIST_MAX = 24; // wide range so tooth lengths look irregular, not uniform
const KINK_MIN = 0.16; // ~9deg
const KINK_MAX = 1.05; // ~60deg

const COURSE_DIST_MIN = 40; // px of travel before the next guaranteed course change
const COURSE_DIST_MAX = 130;
const COURSE_ANGLE_MIN = 0.3; // ~17deg
const COURSE_ANGLE_MAX = 1.1; // ~63deg

// How a branch spawns its own pinnae (child branches) as it grows.
const MAX_GENERATION = 4; // 0=main branch ... 4=deepest sub-sub-sub-sub-branch
const GENERATION_UNLOCK_INTERVAL = 1.5; // seconds of holding between unlocking one more generation
const FORK_SPACING_BASE = 15; // px between pinnae on a main branch; scales down each generation
const FORK_ANGLE_MIN = 0.72; // ~41deg off the parent's current heading
const FORK_ANGLE_MAX = 1.05; // ~60deg

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function sign() {
  return Math.random() < 0.5 ? -1 : 1;
}

/** Real ferns carry fewer, simpler pinnae on their smaller leaflets;
 * capping forks-per-branch tighter at deeper generations keeps the
 * self-similar look while bounding how many live tips a hold can
 * spawn (branching factor compounds fast otherwise). */
function maxForksForGeneration(generation) {
  return Math.max(2, 6 - generation);
}

function forkSpacingForGeneration(generation) {
  return Math.max(4, FORK_SPACING_BASE * Math.pow(0.76, generation));
}

/** Deeper (shorter-lived) generations need their course changes scaled
 * down too, same reasoning as forkSpacingForGeneration: a sub-sub-branch
 * only travels a fraction of the distance a main branch does, so its
 * course-change window has to shrink or it would never get to bend at
 * all before running out of energy. */
function courseDistRangeForGeneration(generation) {
  const scale = Math.pow(0.75, generation);
  return {
    min: Math.max(9, COURSE_DIST_MIN * scale),
    max: Math.max(16, COURSE_DIST_MAX * scale),
  };
}

/** A single growing branch tip.
 *
 * `trendAngle` is the branch's actual growth direction — it only moves
 * in the occasional large, random-signed jump driven by
 * distSinceCourseChange/nextCourseChangeDist (see COURSE_* above), so
 * the branch's "average line" visibly bends partway through instead of
 * beelining straight from origin to tip. `angle` is the jagged heading
 * actually drawn each step: trendAngle plus a zigzag offset
 * (`zigOffset`/`zigSign`) that flips side at every kink, so the path
 * hard-alternates left/right rather than random-walking (which would
 * curl instead of zigzag). Children fork relative to `trendAngle`, not
 * `angle`: if forks used the raw jagged heading, siblings would
 * scatter in whatever direction the parent happened to have just
 * kinked toward, which reads as chaotic roots/cracks rather than a
 * fern. Forking off the stable trend is what makes a set of siblings
 * line up into a recognizable comb of pinnae despite the parent's own
 * path zigzagging like lightning.
 *
 * `distSinceFork`/`forkSide`/`forksDone` drive the regularly-spaced,
 * alternating-side pinnae that make a group of children read as one
 * fern frond. */
function makeTip(x, y, angle, energy, width, speed, generation) {
  const gen = generation || 0;
  const courseRange = courseDistRangeForGeneration(gen);
  return {
    x,
    y,
    angle,
    trendAngle: angle,
    zigOffset: 0,
    zigSign: sign(),
    distSinceKink: 0,
    nextKinkDist: randRange(KINK_DIST_MIN, KINK_DIST_MAX),
    distSinceCourseChange: 0,
    nextCourseChangeDist: randRange(courseRange.min, courseRange.max),
    energy,
    maxEnergy: energy,
    width,
    speed,
    generation: gen,
    pathPoints: [{ x, y }],
    distSinceFork: 0,
    forkSide: Math.random() < 0.5 ? -1 : 1,
    forksDone: 0,
  };
}

/** Spawns one pinna off `parent` at its current position, angled off
 * the parent's smoothed trend direction (see makeTip). Shorter near
 * the parent's own tip than near its base (progress-weighted), so a
 * full set of siblings tapers into the classic lanceolate fern-frond
 * silhouette instead of a uniform comb. */
function makeChildTip(parent) {
  const side = parent.forkSide;
  const angle = parent.trendAngle + side * randRange(FORK_ANGLE_MIN, FORK_ANGLE_MAX);
  const progress = 1 - parent.energy / parent.maxEnergy; // 0 near parent's start, 1 near its end
  const energy = Math.max(38, parent.maxEnergy * randRange(0.44, 0.62) * (1 - progress * 0.4));
  return makeTip(
    parent.x,
    parent.y,
    angle,
    energy,
    parent.width * randRange(0.5, 0.62),
    parent.speed * randRange(0.85, 1.05),
    parent.generation + 1
  );
}

/** Moves a tip that's done growing into session.trunks — kept for
 * architectural parity with the other engines (undo/history reads
 * this the same way). */
function archiveTip(session, tip) {
  if (tip.pathPoints.length < 2) return;
  const decimated = [];
  for (let i = 0; i < tip.pathPoints.length; i += 3) decimated.push(tip.pathPoints[i]);
  const last = tip.pathPoints[tip.pathPoints.length - 1];
  if (decimated[decimated.length - 1] !== last) decimated.push(last);
  session.trunks.push({
    generation: tip.generation,
    points: decimated,
    baseWidth: tip.width,
    lastRedrawWidth: tip.width,
  });
}

/**
 * Draws a single straight scorched segment: a soft brown halo, a mid
 * char tone, and a near-black core. Deliberately NOT smoothed into a
 * curve — real lightning (see the reference photo) is a series of
 * straight runs meeting at hard angular vertices, so every segment is
 * drawn as a plain line and consecutive segments are left to meet at
 * whatever sharp angle the steering (see stepGrowthSession) produced.
 */
function drawSegment(ctx, x0, y0, x1, y1, widthPx) {
  ctx.lineCap = 'round';

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
 * Draws one straight growth segment (see drawSegment), replicated
 * across every symmetric branch when the session is in symmetric mode.
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
 * for a canonical tip being mirrored radially. */
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
 * mark and radiates the requested number of main branches outward.
 *
 * @param {object} [options]
 * @param {number} [options.branchCount] how many main branches (1-8)
 * @param {boolean} [options.symmetric] when true, only ONE canonical
 *   branch (and its whole recursive fern) is simulated in local
 *   coordinates; every draw call mirrors it at `branchCount`
 *   evenly-spaced rotations.
 */
function createGrowthSession(ctx, x, y, options) {
  const opts = options || {};
  const branchCount = clamp(Math.round(opts.branchCount || INITIAL_BRANCHES), 1, 8);
  const symmetric = !!opts.symmetric;

  drawBurnDot(ctx, x, y);

  const maxSegments = symmetric ? Math.max(300, Math.round(MAX_SEGMENTS / branchCount)) : MAX_SEGMENTS;
  const maxActiveTips = symmetric ? Math.max(10, Math.round(MAX_ACTIVE_TIPS / branchCount)) : MAX_ACTIVE_TIPS;

  if (symmetric) {
    const tip = makeTip(0, 0, 0, randRange(260, 400), randRange(3.2, 4.2), randRange(140, 190), 0);
    return {
      symmetric: true,
      branchCount,
      rotationBase: Math.random() * TAU,
      worldOriginX: x,
      worldOriginY: y,
      tips: [tip],
      trunks: [],
      holdTime: 0,
      maxUnlockedGeneration: 1,
      segmentCount: 0,
      maxSegments,
      maxActiveTips,
    };
  }

  // Evenly spaced (with a little jitter) rather than fully random: main
  // branches that happen to land close together would crowd each
  // other's pinnae right at the root, tangling what should read as
  // separate fern fronds into one confused mass.
  const tips = [];
  const baseAngle = Math.random() * TAU;
  for (let i = 0; i < branchCount; i++) {
    const angle = baseAngle + (i / branchCount) * TAU + randRange(-0.3, 0.3);
    tips.push(makeTip(x, y, angle, randRange(260, 400), randRange(3.2, 4.2), randRange(140, 190), 0));
  }

  return {
    symmetric: false,
    originX: x,
    originY: y,
    tips,
    trunks: [],
    holdTime: 0,
    maxUnlockedGeneration: 1,
    segmentCount: 0,
    maxSegments,
    maxActiveTips,
  };
}

/**
 * Advances one growth session by dt seconds. Every active tip — main
 * branch or any depth of sub-branch — is steered with the same jagged
 * wobble+kink technique and drawn as a straight, unsmoothed segment,
 * so the accumulated path reads as a real lightning-style zigzag. As
 * a tip travels, it periodically spawns a child pinna alternating
 * left/right, but only up to whatever generation the current hold
 * duration has unlocked — so the fern visibly grows more intricate,
 * generation by generation, for as long as the pointer is held.
 */
function stepGrowthSession(ctx, session, dt) {
  session.holdTime += dt;
  session.maxUnlockedGeneration = Math.min(
    MAX_GENERATION,
    1 + Math.floor(session.holdTime / GENERATION_UNLOCK_INTERVAL)
  );

  if (session.segmentCount >= session.maxSegments) return;

  const nextTips = [];

  for (const tip of session.tips) {
    if (tip.energy <= 0) continue;

    // Jagged, lightning-like steering — identical technique at every
    // generation, so nothing in this engine is ever a straight line.
    // The drawn heading hard-flips to the opposite side of trendAngle
    // at each kink and holds dead straight until the next one, which is
    // what actually produces a zigzag instead of a curl (see makeTip).
    tip.angle = tip.trendAngle + tip.zigOffset;

    const stepLen = tip.speed * dt;
    const nx = tip.x + Math.cos(tip.angle) * stepLen;
    const ny = tip.y + Math.sin(tip.angle) * stepLen;

    const energyFrac = clamp(tip.energy / tip.maxEnergy, 0, 1);
    const widthPx = Math.max(0.6, tip.width * Math.pow(energyFrac, 1.1));
    drawReplicatedSegment(ctx, session, tip.x, tip.y, nx, ny, widthPx);
    session.segmentCount++;

    tip.x = nx;
    tip.y = ny;
    tip.energy -= stepLen;
    tip.distSinceFork += stepLen;
    tip.pathPoints.push({ x: nx, y: ny });

    // Distance-scheduled kink: guarantees the next flip within a short,
    // bounded travel distance (see the constants' comment above) rather
    // than leaving it to a per-frame coin flip that can run long.
    tip.distSinceKink += stepLen;
    if (tip.distSinceKink >= tip.nextKinkDist) {
      tip.zigSign *= -1;
      tip.zigOffset = tip.zigSign * randRange(KINK_MIN, KINK_MAX);
      tip.distSinceKink = 0;
      tip.nextKinkDist = randRange(KINK_DIST_MIN, KINK_DIST_MAX);
    }

    // Distance-scheduled course change: bends the branch's actual
    // growth direction by a large, random-signed amount every so often
    // (see COURSE_* above), so the path the zigzag rides on top of
    // wanders instead of beelining outward — this is what stops the
    // overall direction from reading as one obvious straight line.
    tip.distSinceCourseChange += stepLen;
    if (tip.distSinceCourseChange >= tip.nextCourseChangeDist) {
      tip.trendAngle += sign() * randRange(COURSE_ANGLE_MIN, COURSE_ANGLE_MAX);
      tip.distSinceCourseChange = 0;
      const courseRange = courseDistRangeForGeneration(tip.generation);
      tip.nextCourseChangeDist = randRange(courseRange.min, courseRange.max);
    }

    const survives = tip.energy > 0 && session.segmentCount < session.maxSegments;
    if (survives) {
      const canFork =
        tip.generation + 1 <= session.maxUnlockedGeneration &&
        tip.forksDone < maxForksForGeneration(tip.generation) &&
        tip.distSinceFork >= forkSpacingForGeneration(tip.generation) &&
        session.tips.length + nextTips.length < session.maxActiveTips;
      if (canFork) {
        const child = makeChildTip(tip);
        nextTips.push(child);
        tip.distSinceFork = 0;
        tip.forkSide *= -1;
        tip.forksDone++;
      }
      nextTips.push(tip);
    } else {
      archiveTip(session, tip);
    }
  }

  session.tips = nextTips;
}

/** Matches the 3-point (prev/cur/next) signature the other engines'
 * strokeGrowthPath expose for src/burning.js's currently-disabled
 * Constant-mode re-stroking; this engine draws straight segments, so
 * it only needs the cur->next leg. */
function strokeGrowthPath(ctx, session, p0x, p0y, p1x, p1y, p2x, p2y, widthPx) {
  drawReplicatedSegment(ctx, session, p1x, p1y, p2x, p2y, widthPx);
}

  const engine = {
    drawBurnDot,
    createGrowthSession,
    stepGrowthSession,
    drawTipGlow,
    getTipWorldPositions,
    strokeGrowthPath,
  };

  App.electricFern = engine;
  App.fractalEngines = App.fractalEngines || {};
  App.fractalEngines.electricfern = engine;
})(window.App = window.App || {});
