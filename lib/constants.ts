export const CAMPAIGN_TYPES = [
  'Back to School',
  'Black Friday',
  'Book Pack',
  'Boxing Day',
  'Click Frenzy',
  'Cyber Monday',
  'Easter',
  'EOFY',
  'Excel Sale',
  'HSC/Senior',
  'May Sale',
  'NAPLAN',
  'Secret Sale',
  'Selective/Scholarship',
  'Shipping Promo',
  'Stocktake',
  'Storewide Sale',
  'Targeting',
  'Teacher Segment',
  'Term Sale',
  'Other',
] as const;

export const CAMPAIGN_COLORS: Record<string, string> = {
  'Back to School':        '#1976D2',
  'Black Friday':          '#1a1a2e',
  'Book Pack':             '#2E7D32',
  'Boxing Day':            '#C62828',
  'Click Frenzy':          '#F57F17',
  'Cyber Monday':          '#424242',
  'Easter':                '#66BB6A',
  'EOFY':                  '#B71C1C',
  'Excel Sale':            '#558B2F',
  'HSC/Senior':            '#AD1457',
  'May Sale':              '#E91E63',
  'NAPLAN':                '#E65100',
  'Secret Sale':           '#7b2d8b',
  'Selective/Scholarship': '#00695C',
  'Shipping Promo':        '#4527A0',
  'Stocktake':             '#37474F',
  'Storewide Sale':        '#00897B',
  'Targeting':             '#6A1B9A',
  'Teacher Segment':       '#1565C0',
  'Term Sale':             '#0288D1',
  'Other':                 '#757575',
};

// Australian financial year month order: Jul → Jun
export const FY_MONTHS = [
  'July', 'August', 'September', 'October',
  'November', 'December', 'January', 'February',
  'March', 'April', 'May', 'June',
];

// Calendar year order for "All" view
export const ALL_MONTHS = [
  'January', 'February', 'March', 'April',
  'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
];

export const FY_OPTIONS = ['FY25', 'FY26', 'FY27', 'All'] as const;

export const BRANDS = [
  'Pascal Press',
  'Excel',
  'All Brands',
] as const;

export const BOARD_NAME = 'Pascal Press Marketing Planner';
export const SPEND_BOARD_NAME = 'Pascal Press Marketing Spend';

export const SPEND_BRANDS = ['Pascal Press', 'Excel Test Zone'] as const;
export type SpendBrand = typeof SPEND_BRANDS[number];

// Full-year (annualised) draft budgets per brand — used for the Finance tab KPI card
export const ANNUAL_BUDGETS: Record<string, number> = {
  'Pascal Press':    103400,  // Online Adv $22k + Google $42k + Facebook $28k + Mktg/PR $3.6k + Promo-Prizes $3k + Brochures $4.8k
  'Excel Test Zone':  36000,  // Google $24k + Facebook $12k
};

export const SPEND_CHANNELS = [
  'Google Ads',
  'Meta Ads',
  'ChatGPT Ads',
  'Online Advertising',
  'Marketing/PR',
  'Promotion - Prizes',
  'Brochures/Catalogues',
  'Promotional Material',
  'Additional Indirect',
] as const;

export const SPEND_COLUMNS_TO_CREATE = [
  { title: 'Brand',               type: 'text'      },
  { title: 'Channel',             type: 'text'      },
  { title: 'Month',               type: 'text'      },
  { title: 'FY',                  type: 'text'      },
  { title: 'Budget',              type: 'numbers'   },
  { title: 'Actual Spend',        type: 'numbers'   },
  { title: 'Attributed Revenue',  type: 'numbers'   },
  { title: 'Indirect Revenue',    type: 'numbers'   },
  { title: 'Notes',               type: 'long_text' },
] as const;

export const COLUMNS_TO_CREATE = [
  { title: 'Promo Code',   type: 'text'      },
  { title: 'Type',         type: 'text'      },
  { title: 'Month',        type: 'text'      },
  { title: 'Date Range',   type: 'text'      },
  { title: 'Revenue',      type: 'numbers'   },
  { title: 'Orders',       type: 'numbers'   },
  { title: 'Units Sold',   type: 'numbers'   },
  { title: 'FY',           type: 'text'      },
  { title: 'Brand',        type: 'text'      },
  { title: 'Status',       type: 'text'      },
  { title: 'Notes',        type: 'long_text' },
] as const;
