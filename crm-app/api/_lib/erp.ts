// Reads ERP sales orders through the ERP's own API, as the signed-in user.
// The ERP's row-level security decides what the user may see; the CRM never
// holds ERP credentials and never writes to the ERP.
import type { ServerConfig } from './config.js'
import { HttpError } from './auth.js'

export interface ErpSalesOrder {
  sales_order_id: string
  sku: string | null
  warehouse_id: string | null
  order_qty: number | null
  order_date: string | null
  status: string | null
}

export type ErpOrderReader = (token: string, ids?: string[]) => Promise<ErpSalesOrder[]>

export function erpOrderReader(cfg: ServerConfig): ErpOrderReader {
  return async (token, ids) => {
    const params = new URLSearchParams({ select: 'sales_order_id,sku,warehouse_id,order_qty,order_date,status', order: 'sales_order_id' })
    if (ids) params.set('sales_order_id', `in.(${ids.map((i) => `"${i.replace(/"/g, '')}"`).join(',')})`)
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/sales_orders?${params}`, {
      headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${token}`, 'Accept-Profile': 'api' },
    })
    if (!res.ok) throw new HttpError(502, `Could not read ERP sales orders (HTTP ${res.status}).`)
    return (await res.json()) as ErpSalesOrder[]
  }
}
