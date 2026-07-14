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
  ];

  const settings = {
    fractalType: FRACTAL_TYPES[0].id,
    branches: 4,
    symmetry: false,
  };

  App.FRACTAL_TYPES = FRACTAL_TYPES;
  App.settings = settings;
})(window.App = window.App || {});
