/**
 * Toolbar.js — horizontal toolbar below the menu bar.
 * Buttons: Game Manager, Scene Builder, UI Builder, Input Manager, Components, Tools, Camera Builder
 */

import { makeFloatable } from './FloatBar.js';

export function createToolbar(options = {}) {
  const bar = document.createElement('div');
  bar.id = 'toolbar';

  const actions = [
    { id: 'game-manager',   label: 'Game Manager'   },
    { id: 'ui-builder',     label: 'UI Builder'     },
    { id: 'components',     label: 'Components'     },
    { id: 'tools',          label: 'Tools'          },
    { id: 'scene-builder',  label: 'Scene Builder'  },
    { id: 'camera-builder', label: 'Camera Builder' },
    { id: 'input-manager',  label: 'Input Manager'  },
  ];

  actions.forEach(a => {
    if (a.id === 'tools') {
      bar.appendChild(_buildToolsButton(bar));
      return;
    }

    const btn = document.createElement('button');
    btn.className = 'toolbar-btn';
    btn.textContent = a.label;
    btn.dataset.action = a.id;
    btn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('cyco-action', { detail: a.id }));
    });
    bar.appendChild(btn);
  });

  // Close any open dropup when clicking outside the toolbar
  if (!options.noFloatBtn) {
    setTimeout(() => {
      const outsideHandler = (e) => {
        if (!bar.contains(e.target)) {
          bar.querySelectorAll('.toolbar-dd-wrap.open').forEach(w => w.classList.remove('open'));
        }
      };
      document.addEventListener('click', outsideHandler);
      if (bar._toolbarOutsideHandler) {
        document.removeEventListener('click', bar._toolbarOutsideHandler);
      }
      bar._toolbarOutsideHandler = outsideHandler;
    }, 0);
  }

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

// ─── Tools button (dropup menu) ───────────────────────────────────────────

function _buildToolsButton(bar) {
  const wrap = document.createElement('div');
  wrap.className = 'toolbar-dd-wrap';

  const btn = document.createElement('button');
  btn.className = 'toolbar-btn toolbar-dd-btn';
  btn.textContent = 'Tools';
  btn.dataset.action = 'tools';

  const arrow = document.createElement('span');
  arrow.className = 'toolbar-dd-arrow';
  arrow.textContent = '▴';
  btn.appendChild(arrow);

  const menu = document.createElement('div');
  menu.className = 'toolbar-dd-menu';

  // Cyco Modeler entry
  const modelerRow = document.createElement('button');
  modelerRow.className = 'toolbar-dd-row';
  modelerRow.type = 'button';
  modelerRow.textContent = 'Cyco Modeler';
  modelerRow.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.remove('open');
    document.dispatchEvent(new CustomEvent('cyco-action', { detail: 'cyco-modeler' }));
  });
  menu.appendChild(modelerRow);

  wrap.appendChild(btn);
  wrap.appendChild(menu);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close any other open dropups within the same bar
    bar.querySelectorAll('.toolbar-dd-wrap.open').forEach(w => {
      if (w !== wrap) w.classList.remove('open');
    });

    if (wrap.classList.contains('open')) {
      wrap.classList.remove('open');
      return;
    }

    wrap.classList.add('open');

    // Position the menu using fixed coords so it escapes any overflow-hidden
    // ancestor containers (dockview panels clip overflow by default).
    const btnRect = btn.getBoundingClientRect();
    const GAP = 3;
    menu.style.left = `${btnRect.left}px`;
    menu.style.top  = `${btnRect.top - GAP}px`;
    // Re-measure after display, then horizontally center under the button and
    // push it up by its own height so it sits ABOVE the button.
    requestAnimationFrame(() => {
      const mh = menu.offsetHeight;
      const mw = menu.offsetWidth;
      menu.style.top  = `${btnRect.top - GAP - mh}px`;
      menu.style.left = `${btnRect.left + (btnRect.width - mw) / 2}px`;
    });
  });

  return wrap;
}
