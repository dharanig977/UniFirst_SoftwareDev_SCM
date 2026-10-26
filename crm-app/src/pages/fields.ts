// Form field lists for each record type (shared by "new" and "edit" pages).
import type { FieldDef } from '../components/RecordForm'
import { ACCOUNT_STATUSES, ACTIVITY_TYPES, SEGMENTS, STAGES, WAREHOUSES, type Account } from '../lib/types'

export const accountFields: FieldDef[] = [
  { name: 'account_name', label: 'Account name', required: true },
  { name: 'segment', label: 'Segment', type: 'select', options: SEGMENTS, required: true },
  { name: 'account_status', label: 'Status', type: 'select', options: ACCOUNT_STATUSES, required: true },
  { name: 'industry', label: 'Industry' },
  { name: 'account_owner', label: 'Account owner' },
  { name: 'home_warehouse_id', label: 'Serving warehouse (ERP)', type: 'select', options: WAREHOUSES, hint: 'The ERP distribution centre that ships to this customer' },
  { name: 'discount_pct', label: 'Discount %', type: 'number', min: 0, max: 50, step: '0.5', hint: 'Off the list price, 0 to 50' },
  { name: 'billing_city', label: 'City' },
  { name: 'billing_state', label: 'State (2 letters)' },
  { name: 'phone', label: 'Phone' },
  { name: 'website', label: 'Website', type: 'url', hint: 'Starts with https://' },
]

export const contactFields = (accounts: Account[]): FieldDef[] => [
  { name: 'account_id', label: 'Account', type: 'select', required: true, options: accounts.map((a) => ({ value: a.account_id, label: a.account_name })) },
  { name: 'first_name', label: 'First name', required: true },
  { name: 'last_name', label: 'Last name', required: true },
  { name: 'title', label: 'Title' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone' },
  { name: 'is_primary', label: 'Primary contact', type: 'checkbox' },
]

export const opportunityFields = (accounts: Account[]): FieldDef[] => [
  { name: 'account_id', label: 'Account', type: 'select', required: true, options: accounts.map((a) => ({ value: a.account_id, label: a.account_name })) },
  { name: 'opportunity_name', label: 'Opportunity name', required: true },
  { name: 'stage', label: 'Stage', type: 'select', options: STAGES, required: true },
  { name: 'amount', label: 'Amount (USD)', type: 'number', min: 0, step: '0.01', required: true },
  { name: 'probability_pct', label: 'Probability %', type: 'number', min: 0, max: 100, step: '1', required: true },
  { name: 'close_date', label: 'Close date', type: 'date', required: true },
  { name: 'owner', label: 'Owner' },
  { name: 'next_step', label: 'Next step' },
]

export const activityFields = (accounts: Account[]): FieldDef[] => [
  { name: 'account_id', label: 'Account', type: 'select', required: true, options: accounts.map((a) => ({ value: a.account_id, label: a.account_name })) },
  { name: 'activity_type', label: 'Type', type: 'select', options: ACTIVITY_TYPES, required: true },
  { name: 'subject', label: 'Subject', required: true },
  { name: 'due_date', label: 'Due date', type: 'date' },
  { name: 'is_done', label: 'Done', type: 'checkbox' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
]
