(function (App) {
  // Constant burning mode: for as long as the pointer is held, keeps
  // pouring "energy" into the fractal already drawn by whichever
  // engine is active (Lichtenberg Burn, BurnaGirl, or any future one),
  // without that engine needing to know Constant mode exists.
  //
  // Two independent effects, both driven by session.holdTime:
  //  1. Growth budgets (how many branches/segments are allowed to
  //     exist) rise over time, so forking keeps producing deeper
  //     generations for as long as the hold continues.
  //  2. Already-finished branches are periodically re-stroked wider,
  //     staged so primary branches thicken first, then sub-branches,
  //     then sub-sub-branches, and so on — each generation's target
  //     width is clamped below the previous generation's, so the
  //     parent > child thickness hierarchy always holds.
  //
  // Single mode never touches any of this: sessions simply don't get
  // `session.burning === 'constant'`, so none of these functions do
  // anything, and the engines' own width math (which reads
  // session.genBoost, left undefined) is byte-for-byte the same as
  // before this feature existed.

  const STAGE_DELAY = 1.4; // seconds between one generation and the next starting to thicken
  const BOOST_RATE = 0.55; // per second, live-edge width multiplier growth
  const MAX_BOOST = 2.4; // cap on the live-edge multiplier
  const GEN_WIDTH_RATIO = 0.85; // a generation's re-stroked width never exceeds this fraction of its parent generation's

  // Every active Constant-mode session gets a thickening pass every
  // single frame (not on a timer) so no branch ever sits untouched long
  // enough for its target width to drift far from what's on screen —
  // that gap is what read as a sudden "pop" rather than smooth growth.
  // Cost is still bounded per frame via round-robin batching, and each
  // touch only eases part-way toward the target (LERP_FACTOR) rather
  // than snapping straight to it, so consecutive touches blend into a
  // continuous thickening motion instead of discrete jumps.
  const THICKEN_BATCH_SIZE = 60; // trunks actually re-stroked per frame
  const LERP_FACTOR = 0.12; // fraction of the remaining width gap closed per touch
  const REDRAW_EPSILON = 0.02; // skip re-stroking a trunk that's already essentially at target

  const ACTIVE_TIPS_GROWTH_RATE = 3; // extra concurrent tips allowed per second held
  const SEGMENTS_GROWTH_RATE = 700; // extra segment budget allowed per second held
  const HARD_MAX_ACTIVE_TIPS = 220;
  const HARD_MAX_SEGMENTS = 45000;

  /** Called right after a session is created, before it's stepped for
   * the first time. Marks the session with its burning mode and (for
   * Constant mode) the extra bookkeeping needed to stage thickening. */
  function prepareSession(session, mode) {
    session.burning = mode === 'constant' ? 'constant' : 'single';
    if (session.burning !== 'constant') return;

    session.holdTime = 0;
    session.thickenCursor = 0;
    session.baseMaxSegments = session.maxSegments;
    session.baseMaxActiveTips = session.maxActiveTips;

    let totalWidth = 0;
    for (const tip of session.tips) totalWidth += tip.width;
    session.rootWidth = session.tips.length ? totalWidth / session.tips.length : 3;
  }

  /** Raises the session's growth budgets the longer it's been held, so
   * forking keeps producing new, deeper generations throughout a long
   * Constant-mode hold instead of plateauing after a couple of seconds. */
  function updateBudgets(session, dt) {
    session.holdTime += dt;

    // Replicated (symmetric) sessions already divide their budget by
    // branchCount at creation time to keep total drawing cost
    // comparable to a non-symmetric session; grow them at the same
    // reduced rate so that relationship holds as the hold continues.
    const scale = session.symmetric ? session.branchCount : 1;

    session.maxActiveTips = Math.min(
      HARD_MAX_ACTIVE_TIPS / scale,
      session.baseMaxActiveTips + (session.holdTime * ACTIVE_TIPS_GROWTH_RATE) / scale
    );
    session.maxSegments = Math.min(
      HARD_MAX_SEGMENTS / scale,
      session.baseMaxSegments + (session.holdTime * SEGMENTS_GROWTH_RATE) / scale
    );
  }

  /** Cheap, per-frame: the live multiplier applied to a still-growing
   * tip's width (see the engines' stepGrowthSession). Staged so
   * generation 0 starts boosting immediately, generation 1 after
   * STAGE_DELAY seconds, generation 2 after 2×STAGE_DELAY, etc. */
  function updateGenBoost(session) {
    const boosts = [];
    for (let g = 0; g <= session.maxGenerationSeen; g++) {
      const active = Math.max(0, session.holdTime - g * STAGE_DELAY);
      boosts[g] = Math.min(MAX_BOOST, 1 + active * BOOST_RATE);
    }
    session.genBoost = boosts;
  }

  /** The absolute width each generation's *archived* trunks should be
   * re-stroked at right now: representative observed width for that
   * generation, boosted by time, then clamped below the previous
   * generation's target so the hierarchy is never violated. */
  function computeGenTargetWidths(session) {
    const refWidth = [];
    for (const trunk of session.trunks) {
      const g = trunk.generation;
      if (refWidth[g] === undefined || trunk.baseWidth > refWidth[g]) refWidth[g] = trunk.baseWidth;
    }
    for (const tip of session.tips) {
      const g = tip.generation;
      if (refWidth[g] === undefined || tip.width > refWidth[g]) refWidth[g] = tip.width;
    }
    if (refWidth[0] === undefined) refWidth[0] = session.rootWidth;

    const widths = [];
    let prev = null;
    for (let g = 0; g <= session.maxGenerationSeen; g++) {
      const base = refWidth[g] !== undefined ? refWidth[g] : prev !== null ? prev * 0.66 : session.rootWidth;
      const boost = (session.genBoost && session.genBoost[g]) || 1;
      let target = base * boost;
      if (prev !== null) target = Math.min(target, prev * GEN_WIDTH_RATIO);
      widths[g] = target;
      prev = target;
    }
    session.genTargetWidth = widths;
  }

  /** Re-strokes a trunk at `width` exactly — used only for the one-time
   * final settle on release, where a precise, immediate result matters
   * more than smoothness (nothing is animating anymore by then). */
  function redrawTrunkExact(ctx, session, engine, trunk, width) {
    const pts = trunk.points;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1] || pts[i];
      engine.strokeGrowthPath(ctx, session, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, width);
    }
    trunk.lastRedrawWidth = width;
  }

  /** Re-strokes a trunk only part-way from its last drawn width toward
   * the current target (LERP_FACTOR of the remaining gap). Called
   * often (every frame, round-robin) with small steps so the branch
   * visibly eases wider over time instead of jumping straight to
   * whatever the target happens to be at the moment it's touched. */
  function redrawTrunkEased(ctx, session, engine, trunk, targetWidth) {
    const nextWidth = trunk.lastRedrawWidth + (targetWidth - trunk.lastRedrawWidth) * LERP_FACTOR;
    redrawTrunkExact(ctx, session, engine, trunk, nextWidth);
  }

  /** Re-strokes a bounded batch of archived trunks per call (round-
   * robin through session.trunks) rather than the whole fractal at
   * once, so thickening a long-held, richly-branched pattern never
   * causes a single expensive frame. Skips (without spending its
   * budget on) trunks already essentially at their target, so the
   * batch's effort concentrates on whichever generation is currently
   * actually still thickening. */
  function runThickeningBatch(ctx, session, engine) {
    const total = session.trunks.length;
    if (!total) return;
    const widths = session.genTargetWidth || [];
    let redrawn = 0;
    let scanned = 0;
    let idx = session.thickenCursor % total;

    while (redrawn < THICKEN_BATCH_SIZE && scanned < total) {
      const trunk = session.trunks[idx];
      const target = widths[trunk.generation];
      if (target !== undefined && Math.abs(target - trunk.lastRedrawWidth) > REDRAW_EPSILON) {
        redrawTrunkEased(ctx, session, engine, trunk, target);
        redrawn++;
      }
      idx = (idx + 1) % total;
      scanned++;
    }
    session.thickenCursor = idx;
  }

  /** Call once per frame for every active Constant-mode session, after
   * stepGrowthSession. */
  function maybeThicken(ctx, session, engine) {
    if (session.burning !== 'constant') return;
    computeGenTargetWidths(session);
    runThickeningBatch(ctx, session, engine);
  }

  /** Call once when a Constant-mode session ends (pointer released),
   * before committing to history: does one full, unbatched pass over
   * every trunk AND every still-growing tip so the frozen result
   * reflects the exact hold duration, not the last periodic tick. */
  function finalizeThickening(ctx, session, engine) {
    if (session.burning !== 'constant') return;

    updateGenBoost(session);
    computeGenTargetWidths(session);
    const widths = session.genTargetWidth || [];

    for (const trunk of session.trunks) {
      const target = widths[trunk.generation];
      if (target !== undefined) redrawTrunkExact(ctx, session, engine, trunk, target);
    }
    for (const tip of session.tips) {
      if (!tip.pathPoints || tip.pathPoints.length < 2) continue;
      const target = widths[tip.generation];
      if (target === undefined) continue;
      redrawTrunkExact(ctx, session, engine, { points: tip.pathPoints, generation: tip.generation, lastRedrawWidth: 0 }, target);
    }
  }

  App.burning = {
    prepareSession,
    updateBudgets,
    updateGenBoost,
    maybeThicken,
    finalizeThickening,
  };
})(window.App = window.App || {});
