// Row shapes returned by the CRM API (crm.* tables, deleted rows left out).

interface Audit {
  created_at: string
  updated_at: string
}

export interface Account extends Audit {
  account_id: string
  account_name: string
  industry: string | null
  segment: 'Enterprise' | 'Mid-Market' | 'Small Business'
  account_status: 'Prospect' | 'Active' | 'On Hold' | 'Inactive'
  account_owner: string | null
  billing_city: string | null
  billing_state: string | null
  home_warehouse_id: string | null
  discount_pct: number
  phone: string | null
  website: string | null
}

export interface Contact extends Audit {
  contact_id: string
  account_id: string
  first_name: string
  last_name: string
  title: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
}

export interface Opportunity extends Audit {
  opportunity_id: string
  account_id: string
  opportunity_name: string
  stage: string
  amount: number
  probability_pct: number
  close_date: string
  owner: string | null
  next_step: string | null
}

export interface Activity extends Audit {
  activity_id: string
  account_id: string
  contact_id: string | null
  opportunity_id: string | null
  activity_type: 'Call' | 'Meeting' | 'Email' | 'Task'
  subject: string
  due_date: string | null
  is_done: boolean
  notes: string | null
}

export interface PriceItem {
  sku: string
  product_name: string
  category: string | null
  list_price: number
  currency: string
}

export interface BudgetVersion {
  budget_version: string
  fiscal_year: number
  version_status: 'Draft' | 'Approved' | 'Archived'
  description: string | null
}

export interface Forecast {
  account_id: string
  sku: string
  forecast_month: string
  forecast_qty: number
  unit_price: number | null
  forecast_source: string
}

export interface Budget {
  budget_version: string
  account_id: string
  sku: string
  budget_month: string
  budget_qty: number
  budget_amount: number
}

export interface CrmOrder extends Audit {
  erp_sales_order_id: string
  account_id: string
  sku: string
  order_date: string
  order_qty: number
  unit_price: number
  currency: string
}

export interface CrmData {
  me: { email: string; role: 'viewer' | 'operator' | null }
  accounts: Account[]
  contacts: Contact[]
  opportunities: Opportunity[]
  activities: Activity[]
  priceList: PriceItem[]
  budgetVersions: BudgetVersion[]
  forecasts: Forecast[]
  budgets: Budget[]
  orders: CrmOrder[]
}

/** An ERP sales order, read straight from the ERP's API (read only). */
export interface ErpSalesOrder {
  sales_order_id: string
  sku: string | null
  warehouse_id: string | null
  order_qty: number | null
  shipped_qty: number | null
  order_date: string | null
  status: string | null
}

export const STAGES = ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'] as const
export const STAGE_PROBABILITY: Record<string, number> = { Prospecting: 10, Qualification: 25, Proposal: 50, Negotiation: 75, 'Closed Won': 100, 'Closed Lost': 0 }
export const SEGMENTS = ['Enterprise', 'Mid-Market', 'Small Business'] as const
export const ACCOUNT_STATUSES = ['Prospect', 'Active', 'On Hold', 'Inactive'] as const
export const ACTIVITY_TYPES = ['Call', 'Meeting', 'Email', 'Task'] as const
export const WAREHOUSES = ['KY-DC-01', 'OH-DC-01', 'TN-DC-01'] as const
