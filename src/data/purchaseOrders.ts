import { db } from '../lib/supabaseClient'
import type { NewPurchaseOrder, PurchaseOrder } from '../lib/types'
import { toDataError } from './errors'

const PO_COLUMNS = 'po_id, supplier_id, sku, warehouse_id, order_qty, order_date, expected_date, status'

export async function listPurchaseOrders(): Promise<PurchaseOrder[]> {
  const { data, error } = await db().from('purchase_orders').select(PO_COLUMNS).order('po_id', { ascending: false })
  if (error) throw toDataError(error, 'Loading purchase orders')
  return data ?? []
}

/**
 * Creates a PO through the database function api.create_purchase_order.
 * The database (not the browser) picks the next PO number, so two people
 * saving at the same time can never produce a duplicate primary key.
 */
export async function createPurchaseOrder(input: NewPurchaseOrder): Promise<PurchaseOrder> {
  const { data, error } = await db().rpc('create_purchase_order', {
    p_supplier_id: input.supplier_id,
    p_sku: input.sku,
    p_warehouse_id: input.warehouse_id,
    p_order_qty: input.order_qty,
    p_expected_date: input.expected_date,
  })
  if (error) throw toDataError(error, 'Creating the purchase order')
  return data as PurchaseOrder
}
