/**
 * PhysicsWorldWindow.js — opener for the Physics World Settings floating panel.
 * Triggered by: Environment → Physics  (cyco-show-properties { type:'physics' }).
 *
 * Usage:
 *   import { PhysicsWorldWindow } from './PhysicsWorldWindow.js';
 *   PhysicsWorldWindow.open();          // opens or focuses
 */

import { BasePanel } from '../panels/BasePanel.js';

export const PhysicsWorldWindow = {
  open() {
    const dvApi = window.__cyco?.dockviewApi;
    if (!dvApi) return;

    const existing = dvApi.getPanel('physics-world-panel');
    if (existing) {
      try { existing.api.group.api.setActive?.(); } catch (_) {}
      return;
    }

    const floating = BasePanel.getSavedFloatingState('physics-world-panel', {
      x:      Math.round((window.innerWidth  - 420) / 2),
      y:      Math.round(window.innerHeight  * 0.2),
      width:  420,
      height: 380,
    });

    dvApi.addPanel({
      id:        'physics-world-panel',
      component: 'PhysicsWorldPanel',
      title:     'Physics World',
      floating,
    });
  },
};
