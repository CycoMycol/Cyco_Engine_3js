/**
 * GameDataSchemas.js
 * Single source of truth for all Game Manager record type schemas,
 * the default empty gameData shape, and the ID generator.
 */

// ── ID generation ─────────────────────────────────────────────────────────────

export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Field type reference ──────────────────────────────────────────────────────
// text      → <input type="text">
// number    → <input type="number">
// color     → CeColorPicker
// boolean   → <input type="checkbox">
// select    → <select> populated from field.options: [{ value, label }]
// textarea  → <textarea>
// sublist   → mini-table; field.subFields defines the columns

// ── INVENTORY schemas ─────────────────────────────────────────────────────────

export const ITEM_SCHEMA = [
  { key: 'id',             label: 'ID',           type: 'text',    default: '',     required: true,  summary: true  },
  { key: 'name',           label: 'Name',         type: 'text',    default: '',     required: true,  summary: true  },
  { key: 'description',    label: 'Description',  type: 'textarea', default: ''                                     },
  { key: 'color',          label: 'Color',        type: 'color',   default: '#c0c0c0',               summary: true  },
  { key: 'parent',         label: 'Parent Item',  type: 'text',    default: ''                                      },
  { key: 'width',          label: 'Width',        type: 'number',  default: 1                                       },
  { key: 'height',         label: 'Height',       type: 'number',  default: 1                                       },
  { key: 'weight',         label: 'Weight',       type: 'number',  default: 0,                       summary: true  },
  { key: 'maxStack',       label: 'Max Stack',    type: 'number',  default: 1,                       summary: true  },
  { key: 'currencyId',     label: 'Price Currency', type: 'text',  default: ''                                      },
  { key: 'price',          label: 'Price Amount', type: 'number',  default: 0                                       },
  { key: 'equipmentSlots', label: 'Equipment Slots', type: 'text', default: ''                                      },
  {
    key: 'properties', label: 'Properties', type: 'sublist', default: [],
    subFields: [
      { key: 'name',        label: 'Name',        type: 'text',   default: '' },
      { key: 'value',       label: 'Value',       type: 'text',   default: '' },
      { key: 'description', label: 'Description', type: 'text',   default: '' },
    ],
  },
  {
    key: 'sockets', label: 'Sockets', type: 'sublist', default: [],
    subFields: [
      { key: 'acceptsItemId', label: 'Accepts Item ID', type: 'text',   default: '' },
      { key: 'maxCount',      label: 'Max Count',       type: 'number', default: 1  },
    ],
  },
];

export const BAG_SCHEMA = [
  { key: 'id',          label: 'ID',          type: 'text',   default: '',     required: true, summary: true },
  { key: 'name',        label: 'Name',        type: 'text',   default: '',     required: true, summary: true },
  { key: 'type',        label: 'Type',        type: 'select', default: 'list', summary: true,
    options: [{ value: 'list', label: 'List' }, { value: 'grid', label: 'Grid' }] },
  { key: 'maxWeight',   label: 'Max Weight',  type: 'number', default: 0  },
  { key: 'maxHeight',   label: 'Max Height',  type: 'number', default: 0  },
  { key: 'equipmentId', label: 'Equipment ID', type: 'text',  default: '' },
  {
    key: 'stock', label: 'Stock', type: 'sublist', default: [],
    subFields: [
      { key: 'itemId',  label: 'Item ID', type: 'text',   default: '' },
      { key: 'amount',  label: 'Amount',  type: 'number', default: 1  },
    ],
  },
  {
    key: 'wealth', label: 'Wealth', type: 'sublist', default: [],
    subFields: [
      { key: 'currencyId', label: 'Currency ID', type: 'text',   default: '' },
      { key: 'amount',     label: 'Amount',      type: 'number', default: 0  },
    ],
  },
];

export const CURRENCY_SCHEMA = [
  { key: 'id',   label: 'ID',   type: 'text', default: '', required: true, summary: true },
  { key: 'name', label: 'Name', type: 'text', default: '', required: true, summary: true },
  {
    key: 'coins', label: 'Coins', type: 'sublist', default: [],
    subFields: [
      { key: 'name',   label: 'Name',   type: 'text',   default: ''  },
      { key: 'symbol', label: 'Symbol', type: 'text',   default: ''  },
      { key: 'value',  label: 'Value',  type: 'number', default: 1   },
    ],
  },
];

export const EQUIPMENT_SCHEMA = [
  { key: 'id',   label: 'ID',   type: 'text', default: '', required: true, summary: true },
  { key: 'name', label: 'Name', type: 'text', default: '', required: true, summary: true },
  {
    key: 'slots', label: 'Slots', type: 'sublist', default: [],
    subFields: [
      { key: 'slotName', label: 'Slot Name', type: 'text', default: '' },
    ],
  },
];

export const LOOT_TABLE_SCHEMA = [
  { key: 'id',   label: 'ID',   type: 'text', default: '', required: true, summary: true },
  { key: 'name', label: 'Name', type: 'text', default: '', required: true, summary: true },
  {
    key: 'entries', label: 'Entries', type: 'sublist', default: [],
    subFields: [
      { key: 'itemId',  label: 'Item ID',    type: 'text',   default: '' },
      { key: 'minAmt',  label: 'Min Amount', type: 'number', default: 1  },
      { key: 'maxAmt',  label: 'Max Amount', type: 'number', default: 1  },
      { key: 'weight',  label: 'Weight',     type: 'number', default: 1  },
    ],
  },
];

export const MERCHANT_SCHEMA = [
  { key: 'id',              label: 'ID',               type: 'text',    default: '',   required: true, summary: true },
  { key: 'name',            label: 'Name',             type: 'text',    default: '',   required: true, summary: true },
  { key: 'shopId',          label: 'Shop ID',          type: 'text',    default: ''                                  },
  { key: 'infiniteCurrency',label: 'Infinite Currency',type: 'boolean', default: false                               },
  { key: 'infiniteStock',   label: 'Infinite Stock',   type: 'boolean', default: false                               },
  { key: 'allowBuyBack',    label: 'Allow Buy Back',   type: 'boolean', default: false                               },
  { key: 'buyRate',         label: 'Buy Rate',         type: 'number',  default: 1.0,                  summary: true },
  { key: 'sellRate',        label: 'Sell Rate',        type: 'number',  default: 0.5,                  summary: true },
];

// ── STATS schemas ─────────────────────────────────────────────────────────────

export const STAT_SCHEMA = [
  { key: 'id',        label: 'ID',          type: 'text',   default: '', required: true, summary: true },
  { key: 'name',      label: 'Name',        type: 'text',   default: '', required: true, summary: true },
  { key: 'acronym',   label: 'Acronym',     type: 'text',   default: '',                 summary: true },
  { key: 'description', label: 'Description', type: 'textarea', default: ''                           },
  { key: 'baseValue', label: 'Base Value',  type: 'number', default: 0,                  summary: true },
  { key: 'formulaId', label: 'Formula ID',  type: 'text',   default: ''                               },
  { key: 'color',     label: 'Color',       type: 'color',  default: '#aaaaaa'                        },
  { key: 'icon',      label: 'Icon',        type: 'text',   default: ''                               },
];

export const ATTRIBUTE_SCHEMA = [
  { key: 'id',         label: 'ID',          type: 'text',   default: '', required: true, summary: true },
  { key: 'name',       label: 'Name',        type: 'text',   default: '', required: true, summary: true },
  { key: 'acronym',    label: 'Acronym',     type: 'text',   default: '',                 summary: true },
  { key: 'description', label: 'Description', type: 'textarea', default: ''                            },
  { key: 'minValue',   label: 'Min Value',   type: 'number', default: 0,                  summary: true },
  { key: 'maxValue',   label: 'Max Value',   type: 'number', default: 100,                summary: true },
  { key: 'color',      label: 'Color',       type: 'color',  default: '#aaaaaa'                        },
  { key: 'icon',       label: 'Icon',        type: 'text',   default: ''                               },
];

export const CLASS_SCHEMA = [
  { key: 'id',          label: 'ID',          type: 'text',     default: '', required: true, summary: true },
  { key: 'name',        label: 'Name',        type: 'text',     default: '', required: true, summary: true },
  { key: 'description', label: 'Description', type: 'textarea', default: ''                               },
  {
    key: 'traits', label: 'Traits', type: 'sublist', default: [],
    subFields: [
      { key: 'statOrAttributeId', label: 'Stat / Attribute ID', type: 'text',   default: '' },
      { key: 'baseValue',         label: 'Base Value',          type: 'number', default: 0  },
    ],
  },
];

export const STATUS_EFFECT_SCHEMA = [
  { key: 'id',          label: 'ID',          type: 'text',     default: '', required: true, summary: true },
  { key: 'name',        label: 'Name',        type: 'text',     default: '', required: true, summary: true },
  { key: 'description', label: 'Description', type: 'textarea', default: ''                               },
  { key: 'color',       label: 'Color',       type: 'color',    default: '#44ff44',           summary: true },
  { key: 'icon',        label: 'Icon',        type: 'text',     default: ''                               },
  { key: 'hasDuration', label: 'Has Duration', type: 'boolean', default: false                            },
  { key: 'duration',    label: 'Duration (s)', type: 'number',  default: 5                               },
  { key: 'stacks',      label: 'Stacks',       type: 'boolean', default: false                            },
];

export const FORMULA_SCHEMA = [
  { key: 'id',         label: 'ID',         type: 'text',     default: '', required: true, summary: true },
  { key: 'name',       label: 'Name',       type: 'text',     default: '', required: true, summary: true },
  { key: 'expression', label: 'Expression', type: 'textarea', default: '',                 summary: true },
];

export const STAT_MODIFIER_SCHEMA = [
  { key: 'id',           label: 'ID',           type: 'text',   default: '', required: true, summary: true },
  { key: 'name',         label: 'Name',         type: 'text',   default: '', required: true, summary: true },
  { key: 'targetStatId', label: 'Target Stat',  type: 'text',   default: '',                 summary: true },
  { key: 'operation',    label: 'Operation',    type: 'select', default: 'add',               summary: true,
    options: [
      { value: 'add',      label: 'Add'      },
      { value: 'multiply', label: 'Multiply' },
      { value: 'override', label: 'Override' },
    ],
  },
  { key: 'value',     label: 'Value',     type: 'number', default: 0  },
  { key: 'condition', label: 'Condition', type: 'text',   default: '' },
];

// ── QUESTS schemas ────────────────────────────────────────────────────────────

export const QUEST_SCHEMA = [
  { key: 'id',          label: 'ID',          type: 'text',     default: '', required: true, summary: true },
  { key: 'name',        label: 'Name',        type: 'text',     default: '', required: true, summary: true },
  { key: 'description', label: 'Description', type: 'textarea', default: ''                               },
  { key: 'icon',        label: 'Icon',        type: 'text',     default: ''                               },
  { key: 'status',      label: 'Status',      type: 'select',   default: 'inactive',          summary: true,
    options: [
      { value: 'inactive', label: 'Inactive' },
      { value: 'active',   label: 'Active'   },
      { value: 'complete', label: 'Complete' },
      { value: 'failed',   label: 'Failed'   },
    ],
  },
  {
    key: 'tasks', label: 'Tasks', type: 'sublist', default: [],
    subFields: [
      { key: 'name',        label: 'Name',        type: 'text',   default: '' },
      { key: 'description', label: 'Description', type: 'text',   default: '' },
      { key: 'type',        label: 'Type',        type: 'select', default: 'boolean',
        options: [{ value: 'boolean', label: 'Boolean' }, { value: 'count', label: 'Count' }] },
      { key: 'targetValue', label: 'Target',      type: 'number', default: 1  },
    ],
  },
];

// ── SHOP schemas (custom Cyco system) ─────────────────────────────────────────

export const SHOP_SCHEMA = [
  { key: 'id',            label: 'ID',             type: 'text',    default: '', required: true, summary: true },
  { key: 'name',          label: 'Name',           type: 'text',    default: '', required: true, summary: true },
  { key: 'currencyId',    label: 'Currency ID',    type: 'text',    default: ''                               },
  { key: 'buyRate',       label: 'Buy Rate',       type: 'number',  default: 1.0,                summary: true },
  { key: 'sellRate',      label: 'Sell Rate',      type: 'number',  default: 0.5,                summary: true },
  { key: 'infiniteStock', label: 'Infinite Stock', type: 'boolean', default: false                            },
  {
    key: 'listings', label: 'Listings', type: 'sublist', default: [],
    subFields: [
      { key: 'itemId', label: 'Item ID', type: 'text',   default: ''  },
      { key: 'price',  label: 'Price',   type: 'number', default: 0   },
      { key: 'stock',  label: 'Stock',   type: 'number', default: -1  },
    ],
  },
];

export const AUCTION_SCHEMA = [
  { key: 'id',              label: 'ID',               type: 'text',   default: '', required: true, summary: true },
  { key: 'name',            label: 'Name',             type: 'text',   default: '', required: true, summary: true },
  { key: 'currencyId',      label: 'Currency ID',      type: 'text',   default: ''                               },
  { key: 'listingFee',      label: 'Listing Fee',      type: 'number', default: 0,                  summary: true },
  { key: 'defaultDuration', label: 'Duration (hours)', type: 'number', default: 24,                 summary: true },
  {
    key: 'listings', label: 'Listings', type: 'sublist', default: [],
    subFields: [
      { key: 'itemId',       label: 'Item ID',      type: 'text',   default: '' },
      { key: 'startPrice',   label: 'Start Price',  type: 'number', default: 0  },
      { key: 'buyoutPrice',  label: 'Buyout Price', type: 'number', default: 0  },
      { key: 'duration',     label: 'Duration (h)', type: 'number', default: 24 },
    ],
  },
];

export const TRADE_SCHEMA = [
  { key: 'id',   label: 'ID',   type: 'text', default: '', required: true, summary: true },
  { key: 'name', label: 'Name', type: 'text', default: '', required: true, summary: true },
  {
    key: 'giveItems', label: 'Give Items', type: 'sublist', default: [],
    subFields: [
      { key: 'itemId',  label: 'Item ID', type: 'text',   default: '' },
      { key: 'amount',  label: 'Amount',  type: 'number', default: 1  },
    ],
  },
  {
    key: 'receiveItems', label: 'Receive Items', type: 'sublist', default: [],
    subFields: [
      { key: 'itemId',  label: 'Item ID', type: 'text',   default: '' },
      { key: 'amount',  label: 'Amount',  type: 'number', default: 1  },
    ],
  },
];

// ── Schema registry ───────────────────────────────────────────────────────────
// Maps module → subType → schema array

export const SCHEMAS = {
  inventory: {
    items:       ITEM_SCHEMA,
    bags:        BAG_SCHEMA,
    currencies:  CURRENCY_SCHEMA,
    equipment:   EQUIPMENT_SCHEMA,
    lootTables:  LOOT_TABLE_SCHEMA,
    merchants:   MERCHANT_SCHEMA,
  },
  stats: {
    stats:         STAT_SCHEMA,
    attributes:    ATTRIBUTE_SCHEMA,
    classes:       CLASS_SCHEMA,
    statusEffects: STATUS_EFFECT_SCHEMA,
    formulas:      FORMULA_SCHEMA,
    statModifiers: STAT_MODIFIER_SCHEMA,
  },
  quests: {
    quests: QUEST_SCHEMA,
  },
  shop: {
    shops:    SHOP_SCHEMA,
    auctions: AUCTION_SCHEMA,
    trades:   TRADE_SCHEMA,
  },
};

// ── Default empty project gameData ────────────────────────────────────────────

export const EMPTY_GAME_DATA = {
  inventory: {
    items:      [],
    bags:       [],
    currencies: [],
    equipment:  [],
    lootTables: [],
    merchants:  [],
  },
  stats: {
    stats:         [],
    attributes:    [],
    classes:       [],
    statusEffects: [],
    formulas:      [],
    statModifiers: [],
  },
  quests: {
    quests: [],
  },
  shop: {
    shops:    [],
    auctions: [],
    trades:   [],
  },
};

/**
 * Build a blank record from a schema (all defaults, fresh ID).
 * @param {Array} schema
 * @returns {Object}
 */
export function blankRecord(schema) {
  const record = {};
  for (const field of schema) {
    if (field.key === 'id') {
      record.id = generateId();
    } else {
      record[field.key] = field.default !== undefined
        ? (Array.isArray(field.default) ? [] : field.default)
        : '';
    }
  }
  return record;
}
