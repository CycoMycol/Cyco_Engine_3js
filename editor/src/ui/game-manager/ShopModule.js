/**
 * ShopModule.js — Shop & Trade tab for Game Manager.
 * Sub-types: Shops, Auction Houses, Trades
 */

import { BaseModule } from './BaseModule.js';

export class ShopModule extends BaseModule {
  constructor() {
    super('shop', [
      { key: 'shops',    label: 'Shops'          },
      { key: 'auctions', label: 'Auction Houses' },
      { key: 'trades',   label: 'Trades'         },
    ]);
  }
}
