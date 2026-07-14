// Classic script (not a module) so the page also works when opened
// directly via file:// (double-click), where module scripts are
// blocked by browsers' cross-origin module-fetch restrictions.
// Exposes its API on the shared App namespace instead of using
// import/export.
(function (App) {
  const TAU = Math.PI * 2;

  // Deterministic PRNG (mulberry32) so a texture can be regenerated
  // identically across resizes without visibly "jumping".
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rand(rng, min, max) {
    return min + rng() * (max - min);
  }

  function randInt(rng, min, max) {
    return Math.floor(rand(rng, min, max + 1));
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  App.utils = { TAU, mulberry32, rand, randInt, clamp };
})(window.App = window.App || {});
