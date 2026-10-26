// Reads for the Inventory & Analytics screen.
import { db } from '../lib/supabaseClient'
import type { InventorySnapshot, ReconciliationRow, SalesOrder } from '../lib/types'
import { toDataError } from './errors'

/** Rows from reporting.vw_inventory_reconciliation (exposed as api.inventory_reconciliation). */
export async function listInventoryReconciliation(): Promise<ReconciliationRow[]> {
  const { data, error } = await db()
    .from('inventory_reconciliation')
    .select('snapshot_id, sku, product_name, warehouse_id, snapshot_qty, reserved_qty, snapshot_at, receipt_after_snapshot, adjusted_on_hand, adjusted_available')
    .order('sku')
    .order('warehouse_id')
  if (error) throw toDataError(error, 'Loading inventory reconciliation')
  return data ?? []
}

export async function listInventorySnapshots(): Promise<InventorySnapshot[]> {
  const { data, error } = await db().from('inventory_snapshots').select('snapshot_id, sku, warehouse_id, snapshot_qty, reserved_qty, snapshot_at')
  if (error) throw toDataError(error, 'Loading inventory snapshots')
  return data ?? []
}

/** Sales orders are used to check whether reserved quantities make sense. */
export async function listSalesOrders(): Promise<SalesOrder[]> {
  const { data, error } = await db().from('sales_orders').select('sales_order_id, sku, warehouse_id, order_qty, shipped_qty, order_date, status')
  if (error) throw toDataError(error, 'Loading sales orders')
  return data ?? []
}
