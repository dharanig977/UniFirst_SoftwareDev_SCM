import { db } from '../lib/supabaseClient'
import type { GoodsReceipt, NewGoodsReceipt } from '../lib/types'
import { toDataError } from './errors'

const GR_COLUMNS = 'receipt_id, po_id, sku, warehouse_id, received_qty, receipt_date'

export async function listGoodsReceipts(): Promise<GoodsReceipt[]> {
  const { data, error } = await db().from('goods_receipts').select(GR_COLUMNS).order('receipt_id', { ascending: false })
  if (error) throw toDataError(error, 'Loading goods receipts')
  return data ?? []
}

/**
 * Records a receipt through api.record_goods_receipt. The function locks the
 * PO, re-checks the remaining quantity inside the database, rejects
 * over-receipts with an "OVER_RECEIPT" error and copies SKU/warehouse from the PO.
 */
export async function recordGoodsReceipt(input: NewGoodsReceipt): Promise<GoodsReceipt> {
  const { data, error } = await db().rpc('record_goods_receipt', {
    p_po_id: input.po_id,
    p_received_qty: input.received_qty,
    p_receipt_date: input.receipt_date,
  })
  if (error) throw toDataError(error, 'Recording the goods receipt')
  return data as GoodsReceipt
}
