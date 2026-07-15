(function (App) {
  // Registry of available fractal growth designs. Each entry only
  // needs an id/name/description for the UI right now; adding a new
  // design later means dropping another growth engine (matching
  // lichtenberg.js's exported shape) in and appending it here.
  const FRACTAL_TYPES = [
    {
      id: 'lichtenberg',
      name: 'Lichtenberg Burn',
      description: 'Organic branching burn pattern',
    },
    {
      id: 'burnagirl',
      name: 'BurnaGirl',
      description: 'Dense, jagged multi-generation branching',
    },
    {
      id: 'electricfern',
      name: 'Electric Fern',
      description: 'Sweeping main channel with dense fern-like leaflets',
    },
  ];

  const settings = {
    fractalType: FRACTAL_TYPES[0].id,
    branches: 4,
    symmetry: false,
    // 'single': grows once while held, stops on release (default,
    // original behavior). 'constant': keeps feeding energy into the
    // fractal for as long as it's held — see src/burning.js.
    burning: 'single',
  };

  App.FRACTAL_TYPES = FRACTAL_TYPES;
  App.settings = settings;
})(window.App = window.App || {});
