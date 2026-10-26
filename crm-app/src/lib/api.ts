// Talks to the CRM server (/api/crm). Every call carries the user's sign-in
// token; the server checks it with Supabase and applies the role rules.
import { getClient } from './supabaseClient'
import type { CrmData, ErpSalesOrder } from './types'

async function token(): Promise<string> {
  const { data } = await getClient().auth.getSession()
  const t = data.session?.access_token
  if (!t) throw new Error('You are signed out. Sign in again.')
  return t
}

async function call<T>(r: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/crm?r=${encodeURIComponent(r)}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${await token()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Could not reach the CRM server. Check your connection and try again.')
  }
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // Non-JSON means the server function itself failed (or isn't deployed).
  }
  if (!res.ok) {
    const msg = (parsed as { error?: string } | null)?.error
    throw new Error(msg ?? `The CRM server returned HTTP ${res.status}. If this is a new deployment, check the Vercel function logs.`)
  }
  return parsed as T
}

export type Entity = 'accounts' | 'contacts' | 'opportunities' | 'activities'
export interface Cell {
  account_id: string
  sku: string
  month: string
  qty: number | null
}
export interface AutoLinkResult {
  erpOrders: number
  linked: number
  refreshed: number
  alreadyLinked: number
  skipped: { sales_order_id: string; reason: string }[]
}

export const api = {
  bootstrap: () => call<CrmData>('bootstrap'),
  save: <T>(entity: Entity, data: Record<string, unknown>, id?: string) => call<T>('save', { entity, id, data }),
  remove: (entity: Entity, id: string) => call<{ deleted: string }>('delete', { entity, id }),
  saveForecast: (cells: Cell[], source?: string) => call<{ saved: number; removed: number }>('forecast', { cells, source }),
  saveBudget: (version: string, cells: Cell[]) => call<{ saved: number; removed: number }>('budget', { version, cells }),
  createBudgetVersion: (v: { budget_version: string; fiscal_year: number; copy_from?: string; description?: string }) =>
    call<{ created: string; copied: number }>('budget-version', { action: 'create', ...v }),
  approveBudgetVersion: (budget_version: string) => call<{ approved: string }>('budget-version', { action: 'approve', budget_version }),
  autoLink: () => call<AutoLinkResult>('link-orders', { mode: 'auto' }),
  linkOrder: (sales_order_id: string, account_id: string) => call('link-orders', { mode: 'manual', sales_order_id, account_id }),
  unlinkOrder: (sales_order_id: string) => call('link-orders', { mode: 'unlink', sales_order_id }),
}

/** ERP sales orders, read directly from the ERP's API with the same sign-in (read only). */
export async function listErpSalesOrders(): Promise<ErpSalesOrder[]> {
  const { data, error } = await getClient()
    .schema('api')
    .from('sales_orders')
    .select('sales_order_id, sku, warehouse_id, order_qty, shipped_qty, order_date, status')
    .order('sales_order_id', { ascending: false })
  if (error) throw new Error(`Loading ERP sales orders failed: ${error.message}`)
  return data ?? []
}
