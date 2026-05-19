/**
 * InventoryModule.js — Inventory tab for Game Manager.
 * Sub-types: Items, Bags, Currencies, Equipment, Loot Tables, Merchants
 */

import { BaseModule } from './BaseModule.js';

export class InventoryModule extends BaseModule {
  constructor() {
    super('inventory', [
      { key: 'items',      label: 'Items'       },
      { key: 'bags',       label: 'Bags'        },
      { key: 'currencies', label: 'Currencies'  },
      { key: 'equipment',  label: 'Equipment'   },
      { key: 'lootTables', label: 'Loot Tables' },
      { key: 'merchants',  label: 'Merchants'   },
    ]);
  }
}
