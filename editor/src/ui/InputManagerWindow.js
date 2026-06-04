/**
 * InputManagerWindow.js — opener for the Input Manager floating panel.
 * Triggered by: Toolbar → Input Manager button  (cyco-action 'input-manager').
 */

export const InputManagerWindow = {
  open() {
    const dvApi = window.__cyco?.dockviewApi;
    if (!dvApi) return;

    const existing = dvApi.getPanel('input-manager-panel');
    if (existing) {
      try { existing.api.group.api.setActive?.(); } catch (_) {}
      return;
    }

    dvApi.addPanel({
      id:        'input-manager-panel',
      component: 'InputManagerPanel',
      title:     'Input Manager',
      floating: {
        x:      Math.round((window.innerWidth  - 420) / 2),
        y:      Math.round(window.innerHeight  * 0.18),
        width:  420,
        height: 340,
      },
    });
  },
};
