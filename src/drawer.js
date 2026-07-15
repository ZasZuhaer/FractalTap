(function (App) {
  const toggleBtn = document.getElementById('drawer-toggle');
  const overlay = document.getElementById('drawer-overlay');
  const panel = document.getElementById('drawer-panel');
  const quickActions = document.getElementById('quick-actions');
  const fractalList = document.getElementById('fractal-list');
  const branchesSlider = document.getElementById('branches-slider');
  const branchesValue = document.getElementById('branches-value');
  const symmetryToggle = document.getElementById('symmetry-toggle');
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const clearBtn = document.getElementById('clear-btn');

  let isOpen = false;

  function renderFractalList() {
    fractalList.innerHTML = '';
    App.FRACTAL_TYPES.forEach((type) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fractal-option';
      btn.setAttribute('role', 'radio');

      const selected = App.settings.fractalType === type.id;
      btn.setAttribute('aria-checked', String(selected));
      if (selected) btn.classList.add('selected');

      const dot = document.createElement('span');
      dot.className = 'fractal-radio-dot';

      const text = document.createElement('span');
      text.className = 'fractal-option-text';
      const name = document.createElement('span');
      name.className = 'fractal-option-name';
      name.textContent = type.name;
      const desc = document.createElement('span');
      desc.className = 'fractal-option-desc';
      desc.textContent = type.description;
      text.appendChild(name);
      text.appendChild(desc);

      btn.appendChild(dot);
      btn.appendChild(text);
      btn.addEventListener('click', () => {
        App.settings.fractalType = type.id;
        renderFractalList();
      });

      li.appendChild(btn);
      fractalList.appendChild(li);
    });
  }

  function updateBranchesLabel() {
    branchesValue.textContent = branchesSlider.value;
  }

  function refreshHistoryButtons() {
    const growing = !!(App.growth && App.growth.isActive());
    undoBtn.disabled = growing || !App.history.canUndo();
    redoBtn.disabled = growing || !App.history.canRedo();
  }

  function openDrawer() {
    // Any in-progress hold gets finalized rather than left dangling
    // (or fought over) while the settings panel is up.
    if (App.growth) App.growth.endAllSessions();

    isOpen = true;
    panel.classList.add('open');
    overlay.classList.add('visible');
    quickActions.classList.add('hidden');
    toggleBtn.setAttribute('aria-expanded', 'true');
    toggleBtn.setAttribute('aria-label', 'Close menu');
    panel.setAttribute('aria-hidden', 'false');
    refreshHistoryButtons();
  }

  function closeDrawer() {
    isOpen = false;
    panel.classList.remove('open');
    overlay.classList.remove('visible');
    quickActions.classList.remove('hidden');
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.setAttribute('aria-label', 'Open menu');
    panel.setAttribute('aria-hidden', 'true');
  }

  toggleBtn.addEventListener('click', () => {
    if (isOpen) closeDrawer();
    else openDrawer();
  });
  overlay.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) closeDrawer();
  });

  branchesSlider.value = String(App.settings.branches);
  updateBranchesLabel();
  branchesSlider.addEventListener('input', () => {
    App.settings.branches = parseInt(branchesSlider.value, 10);
    updateBranchesLabel();
  });

  symmetryToggle.checked = App.settings.symmetry;
  symmetryToggle.addEventListener('change', () => {
    App.settings.symmetry = symmetryToggle.checked;
  });

  // Constant burning mode's UI is disabled for now (App.settings.burning
  // stays at its 'single' default — see settings.js) while the feature
  // gets redesigned; the engine hooks and src/burning.js orchestration
  // module are left in place to build back on later.

  undoBtn.addEventListener('click', () => {
    if (undoBtn.disabled) return;
    App.history.undo();
    refreshHistoryButtons();
  });
  redoBtn.addEventListener('click', () => {
    if (redoBtn.disabled) return;
    App.history.redo();
    refreshHistoryButtons();
  });

  clearBtn.addEventListener('click', () => {
    if (App.board) App.board.clear();
    refreshHistoryButtons();
  });

  renderFractalList();

  App.drawer = {
    isOpen: () => isOpen,
    open: openDrawer,
    close: closeDrawer,
    refreshHistoryButtons,
  };
})(window.App = window.App || {});
