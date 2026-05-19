/**
 * Toolbar.js — horizontal toolbar below the menu bar.
 * Buttons: Game Manager, Scene Builder, UI Builder, Input Manager, Components, Camera Builder
 */

import { makeFloatable } from './FloatBar.js';

export function createToolbar(options = {}) {
  const bar = document.createElement('div');
  bar.id = 'toolbar';

  const actions = [
    { id: 'game-manager',   label: 'Game Manager'   },
    { id: 'ui-builder',     label: 'UI Builder'     },
    { id: 'components',     label: 'Components'     },
    { id: 'scene-builder',  label: 'Scene Builder'  },
    { id: 'camera-builder', label: 'Camera Builder' },
    { id: 'input-manager',  label: 'Input Manager'  },
  ];

  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'toolbar-btn';
    btn.textContent = a.label;
    btn.dataset.action = a.id;
    btn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('cyco-action', { detail: a.id }));
    });
    bar.appendChild(btn);
  });

  // Float toggle (pushed to the right)
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  bar.appendChild(spacer);

  if (!options.noFloatBtn) {
    const toolbarSep = document.createElement('div');
    toolbarSep.className = 'toolbar-separator';
    bar.appendChild(toolbarSep);
    bar.appendChild(makeFloatable(bar));
  }

  return bar;
}
