export interface Campaign {
  id: string;
  name: string;
  promoCode: string;
  type: string;
  month: string;
  dateRange: string;
  revenue: number;
  orders: number;
  unitsSold: number;
  fy: string;
  brand: string;
  status: 'Planned' | 'Complete';
  notes: string;
}

export interface ColumnMap {
  promoCode: string;
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
export type ViewMode = 'calendar' | 'list' | 'finance';
