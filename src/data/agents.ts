// Data access for the AI agents module (migrations 004 + 005 and the Edge Functions
// sales-order-agent, approver-agent, send-notifications).
import { db, getClient } from '../lib/supabaseClient'
import { toDataError } from './errors'

export interface Approval {
  sales_order_id: string
  sku: string
  warehouse_id: string
  order_qty: number
  shipped_qty: number
  order_date: string
  status: string
  account_id: string | null
  account_name: string | null
  unit_price: number
  amount: number
  requested_by: string
  request_text: string | null
  stock_status: string
  available_at_check: number
  approval_status: 'Pending' | 'Approved' | 'Needs Approval' | 'Rejected'
  decided_by: string | null
  decision_reason: string | null
  ai_explanation: string | null
  created_at: string
  decided_at: string | null
}

export interface OrderStock {
  sales_order_id: string
  sku: string
  warehouse_id: string
  status: string
  open_qty: number
  on_hand: number
  reserved_by_others: number
  available: number
  stock_status: 'Available' | 'Partial' | 'Short'
}

export interface Bin {
  bin_id: number
  warehouse_id: string
  sku: string
  bin_code: string
  qty_on_hand: number
  reorder_point: number
}

export interface Notification {
  notification_id: number
  kind: string
  has_recipient: boolean
  subject: string
  body_html: string
  status: 'Queued' | 'Sent' | 'Failed'
  attempts: number
  error: string | null
  created_at: string
  sent_at: string | null
}

export interface Movement {
  movement_id: number
  bin_id: number
  sku: string
  warehouse_id: string
  sales_order_id: string | null
  qty_change: number
  qty_after: number
  created_by: string | null
  created_at: string
}

export interface AgentReply {
  reply?: string
  error?: string
  created?: { order: { sales_order_id: string; amount: number; stock_status: string }; approval: { approval_status?: string; decision_reason?: string; ai_explanation?: string | null; error?: string } }[]
  steps?: { tool: string; ok: boolean }[]
}

async function list<T>(view: string, action: string, order: string, ascending = false): Promise<T[]> {
  const { data, error } = await db().from(view).select('*').order(order, { ascending })
  if (error) throw toDataError(error, action)
  return (data ?? []) as T[]
}

export const listApprovals = () => list<Approval>('sales_order_approvals', 'Loading agent orders', 'created_at')
export const listOrderStock = () => list<OrderStock>('sales_order_stock', 'Loading stock checks', 'sales_order_id')
export const listBins = () => list<Bin>('bins', 'Loading bins', 'bin_code', true)
export const listNotifications = () => list<Notification>('notifications', 'Loading notifications', 'notification_id')
export const listMovements = () => list<Movement>('stock_movements', 'Loading stock movements', 'movement_id')

async function rpc<T>(fn: string, args: Record<string, unknown>, action: string): Promise<T> {
  const { data, error } = await db().rpc(fn, args)
  if (error) throw toDataError(error, action)
  return data as T
}

export const decideOrder = (id: string, approve: boolean, note: string) =>
  rpc<Approval>('decide_sales_order', { p_sales_order_id: id, p_approve: approve, p_note: note || null }, approve ? 'Approving the order' : 'Rejecting the order')

export interface ShipResult {
  sales_order_id: string
  shipped_now: number
  qty_short: number
  status: string
  total_on_hand_after: number
  bins: { bin_code: string; qty_on_hand: number; reorder_point: number }[]
  shortage_alert_id: number | null
}
export const shipOrder = (id: string, qty: number | null) =>
  rpc<ShipResult>('ship_sales_order', { p_sales_order_id: id, p_qty: qty }, 'Shipping the order')

export const queueWeeklyReport = () => rpc<number>('queue_weekly_sales_report', {}, 'Queuing the weekly report')

/** Calls an Edge Function with the signed-in user's token. */
async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getClient().functions.invoke(name, { body })
  if (error) {
    // FunctionsHttpError carries the JSON body in error.context.
    const ctx = (error as { context?: Response }).context
    const detail = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
    throw new Error(detail?.error ?? error.message)
  }
  return data as T
}

export const askSalesAgent = (message: string) => invoke<AgentReply>('sales-order-agent', { message })
export const runApproverOnPending = () => invoke<{ results: unknown[] }>('approver-agent', { review_pending: true })
export const sendQueuedEmails = () => invoke<{ sent: number; results: { notification_id: number; sent: boolean; error?: string }[] }>('send-notifications', {})
