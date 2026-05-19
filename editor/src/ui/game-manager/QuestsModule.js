/**
 * QuestsModule.js — Quests tab for Game Manager.
 * Sub-types: Quests (tasks embedded as sub-list within a quest record)
 */

import { BaseModule } from './BaseModule.js';

export class QuestsModule extends BaseModule {
  constructor() {
    super('quests', [
      { key: 'quests', label: 'Quests' },
    ]);
  }
}
