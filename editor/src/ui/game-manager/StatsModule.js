/**
 * StatsModule.js — Stats tab for Game Manager.
 * Sub-types: Stats, Attributes, Classes, Status Effects, Formulas, Stat Modifiers
 */

import { BaseModule } from './BaseModule.js';

export class StatsModule extends BaseModule {
  constructor() {
    super('stats', [
      { key: 'stats',         label: 'Stats'          },
      { key: 'attributes',    label: 'Attributes'     },
      { key: 'classes',       label: 'Classes'        },
      { key: 'statusEffects', label: 'Status Effects' },
      { key: 'formulas',      label: 'Formulas'       },
      { key: 'statModifiers', label: 'Stat Modifiers' },
    ]);
  }
}
