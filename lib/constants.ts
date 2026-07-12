export const CAMPAIGN_TYPES = [
  'Brand Awareness',
  'Markdown Campaign',
  'General Promotion',
  'Coupon Code Campaign',
  'New Release',
  'Other',
] as const;

export const CAMPAIGN_COLORS: Record<string, string> = {
  'Brand Awareness':      '#1976D2',
  'Markdown Campaign':    '#E65100',
  'General Promotion':    '#2E7D32',
  'Coupon Code Campaign': '#7b2d8b',
  'New Release':          '#00897B',
  'Other':                '#757575',
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
  'Excel Test Zone',
  'Excel HSC Copilot',
  'All Brands',
] as const;

export const BOARD_NAME = 'Pascal Press Marketing Planner';
export const SPEND_BOARD_NAME = 'Pascal Press Marketing Spend';

export const SPEND_BRANDS = ['Pascal Press', 'Excel Test Zone'] as const;
export type SpendBrand = typeof SPEND_BRANDS[number];

// Full-year (annualised) draft budgets per brand — used for the Finance tab KPI card
export const ANNUAL_BUDGETS: Record<string, number> = {
  'Pascal Press':      103400,  // Online Adv $22k + Google $42k + Facebook $28k + Mktg/PR $3.6k + Promo-Prizes $3k + Brochures $4.8k
  'Excel Test Zone':    36000,  // Google $24k + Facebook $12k
  'Excel HSC Copilot':  21600,  // Google $1,800/mo × 12
};

// Fixed monthly Google Ads budgets (source of truth for budget calculations)
// Updated July 2026: PP $8,300/mo, ETZ $3,700/mo, HSC $1,800/mo
export const MONTHLY_GOOGLE_BUDGETS: Record<string, number> = {
  'Pascal Press':      8300,
  'Excel Test Zone':   3700,
  'Excel HSC Copilot':  1800,
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
  { title: 'Notes',        type: 'long_text' },
] as const;

export const COLUMNS_TO_CREATE = [
  { title: 'Campaign Code', type: 'text'     },
  { title: 'Promo Code',   type: 'text'      },
  { title: 'Start Date',   type: 'text'      },
  { title: 'End Date',     type: 'text'      },
  { title: 'Color',        type: 'text'      },
  { title: 'Discount',     type: 'text'      },
  { title: 'Offer Info',   type: 'long_text' },
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
