export interface Campaign {
  id: string;
  name: string;
  campaignCode: string;
  promoCode: string;
  type: string;
  month: string;
  startDate: string;  // ISO "YYYY-MM-DD"
  endDate: string;    // ISO "YYYY-MM-DD"
  dateRange: string;  // display string, computed from startDate/endDate on save
  color: string;      // hex colour, e.g. "#1976D2"; empty = use type colour
  discount: string;   // e.g. "15%" or "$10 off"
  offerInfo: string;  // offer description
  revenue: number;
  orders: number;
  unitsSold: number;
  fy: string;
  brand: string;
  status: 'Planned' | 'Complete';
  notes: string;
}

export interface ColumnMap {
  campaignCode: string | undefined; // optional — column may not exist on older boards
  promoCode: string | undefined;    // optional — column may not exist on older boards
  startDate: string | undefined;    // optional — column may not exist on older boards
  endDate: string | undefined;      // optional — column may not exist on older boards
  color: string | undefined;        // optional — column may not exist on older boards
  discount: string | undefined;     // optional — column may not exist on older boards
  offerInfo: string | undefined;    // optional — column may not exist on older boards
  type: string;
  month: string;
  dateRange: string;
  revenue: string;
  orders: string;
  unitsSold: string;
  fy: string;
  brand: string;
  status: string;
  notes: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface SpendRecord {
  id: string;
  brand: string;
  channel: string;
  month: string;
  fy: string;
  budget: number;
  actualSpend: number;
  attributedRevenue: number;
  indirectRevenue: number;
  notes: string;
}

export interface SpendColumnMap {
  brand: string;
  channel: string;
  month: string;
  fy: string;
  budget: string;
  actualSpend: string;
  attributedRevenue: string;
  indirectRevenue: string;
  notes: string;
}

export type FYFilter = 'FY25' | 'FY26' | 'FY27' | 'All';
export type ViewMode = 'overview' | 'calendar' | 'list' | 'finance' | 'email' | 'action';

export interface OverviewAlert {
  id:       string;
  severity: 'danger' | 'warning' | 'info';
  brand:    'Pascal Press' | 'Excel Test Zone' | 'Email' | 'General';
  message:  string;
}
