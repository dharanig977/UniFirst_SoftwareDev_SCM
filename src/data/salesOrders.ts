import { db } from '../lib/supabaseClient'
import type { SalesOrder } from '../lib/types'
import { toDataError } from './errors'

const SO_COLUMNS = 'sales_order_id, sku, warehouse_id, order_qty, shipped_qty, order_date, status'

export async function listSalesOrders(): Promise<SalesOrder[]> {
  const { data, error } = await db().from('sales_orders').select(SO_COLUMNS).order('sales_order_id', { ascending: false })
  if (error) throw toDataError(error, 'Loading sales orders')
  return data ?? []
}

/** Creates a sales order (status Open, or Draft) through api.create_sales_order. */
export async function createSalesOrder(input: { sku: string; warehouse_id: string; order_qty: number; as_draft: boolean }): Promise<SalesOrder> {
  const { data, error } = await db().rpc('create_sales_order', {
    p_sku: input.sku,
    p_warehouse_id: input.warehouse_id,
    p_order_qty: input.order_qty,
    p_as_draft: input.as_draft,
  })
  if (error) throw toDataError(error, 'Creating the sales order')
  return data as SalesOrder
}

export async function confirmSalesOrder(salesOrderId: string): Promise<SalesOrder> {
  const { data, error } = await db().rpc('confirm_sales_order', { p_sales_order_id: salesOrderId })
  if (error) throw toDataError(error, 'Confirming the sales order')
  return data as SalesOrder
}
