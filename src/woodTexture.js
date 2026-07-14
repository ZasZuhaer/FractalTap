(function (App) {
  const { TAU, mulberry32, rand, randInt } = App.utils;

/**
 * Procedurally renders a realistic wood-plank texture into an
 * offscreen canvas sized in CSS pixels (caller composites it).
 * Uses a seeded RNG so the same seed reproduces the same plank
 * layout after a resize/regenerate.
 */
function createWoodTexture(cssWidth, cssHeight, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cssWidth));
  canvas.height = Math.max(1, Math.round(cssHeight));
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(seed);
  const W = canvas.width;
  const H = canvas.height;

  paintBase(ctx, W, H, rng);
  paintPlankSeams(ctx, W, H, rng);
  paintGrain(ctx, W, H, rng);
  paintKnots(ctx, W, H, rng);
  paintNoise(ctx, W, H, rng);
  paintVignette(ctx, W, H);

  return canvas;
}

function paintBase(ctx, W, H, rng) {
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#8a5a34');
  grad.addColorStop(0.35, '#9c6b3e');
  grad.addColorStop(0.7, '#8a5c36');
  grad.addColorStop(1, '#77492a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Broad warm/cool blotches for tonal variety between planks.
  const blotches = randInt(rng, 4, 8);
  for (let i = 0; i < blotches; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const r = rand(rng, W * 0.15, W * 0.4);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const warm = rng() > 0.5;
    g.addColorStop(0, warm ? 'rgba(150,100,55,0.10)' : 'rgba(70,40,20,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

function paintPlankSeams(ctx, W, H, rng) {
  const plankWidth = rand(rng, 220, 360);
  let x = -rng() * plankWidth;
  while (x < W) {
    x += plankWidth * rand(rng, 0.85, 1.15);
    if (x >= W) break;

    const shade = ctx.createLinearGradient(x - 10, 0, x + 10, 0);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(0.5, 'rgba(0,0,0,0.18)');
    shade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shade;
    ctx.fillRect(x - 10, 0, 20, H);

    ctx.strokeStyle = 'rgba(35,18,8,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
}

function paintGrain(ctx, W, H, rng) {
  const lineCount = Math.round(H / 12);
  for (let i = 0; i < lineCount; i++) {
    const y0 = rng() * H;
    const amp = rand(rng, 3, 20);
    const freq = rand(rng, 0.0015, 0.009);
    const freq2 = freq * rand(rng, 2.2, 3.6);
    const phase = rng() * TAU;
    const dark = rng() > 0.42;

    ctx.beginPath();
    ctx.strokeStyle = dark
      ? `rgba(48,24,10,${rand(rng, 0.05, 0.16)})`
      : `rgba(205,155,95,${rand(rng, 0.03, 0.10)})`;
    ctx.lineWidth = rand(rng, 0.5, 2.0);

    const step = 9;
    for (let x = 0; x <= W; x += step) {
      const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq2 + phase * 1.7) * amp * 0.3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function paintKnots(ctx, W, H, rng) {
  const count = randInt(rng, 1, 3);
  for (let i = 0; i < count; i++) {
    const kx = rand(rng, W * 0.1, W * 0.9);
    const ky = rand(rng, H * 0.1, H * 0.9);
    const kr = rand(rng, 10, 26);

    const core = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
    core.addColorStop(0, 'rgba(28,14,7,0.92)');
    core.addColorStop(0.45, 'rgba(52,29,15,0.55)');
    core.addColorStop(1, 'rgba(52,29,15,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(kx, ky, kr, 0, TAU);
    ctx.fill();

    let r = kr * rand(rng, 1.3, 1.6);
    const maxR = kr * rand(rng, 3.5, 5);
    while (r < maxR) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(42,21,10,${rand(rng, 0.05, 0.14)})`;
      ctx.lineWidth = rand(rng, 0.5, 1.4);
      ctx.ellipse(kx, ky, r, r * rand(rng, 0.82, 1.18), rand(rng, 0, TAU), 0, TAU);
      ctx.stroke();
      r += rand(rng, 4, 9);
    }
  }
}

function paintNoise(ctx, W, H, rng) {
  const tileSize = 128;
  const tile = document.createElement('canvas');
  tile.width = tileSize;
  tile.height = tileSize;
  const tctx = tile.getContext('2d');
  const imgData = tctx.createImageData(tileSize, tileSize);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = 128 + (rng() * 2 - 1) * 45;
    data[i] = v;
    data[i + 1] = v * 0.84;
    data[i + 2] = v * 0.68;
    data[i + 3] = rng() * 38;
  }
  tctx.putImageData(imgData, 0, 0);

  const pattern = ctx.createPattern(tile, 'repeat');
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function paintVignette(ctx, W, H) {
  const g = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.25,
    W / 2, H / 2, Math.max(W, H) * 0.75
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

  App.woodTexture = { createWoodTexture };
})(window.App = window.App || {});
