// Tests for the business rules. Fixtures mirror the shape of the real tables;
// the app itself never uses these constants.
import { describe, expect, it } from 'vitest'
import { investigate, recomputeReconciliation, summarizePurchaseOrders, validateGoodsReceipt, validatePurchaseOrder } from './logic'
import type { GoodsReceipt, InventorySnapshot, PurchaseOrder, ReconciliationRow, SalesOrder } from './types'

const TODAY = '2026-10-26'
const pos: PurchaseOrder[] = [
  { po_id: 'PO-10001', supplier_id: 'SUP-001', sku: 'UFS-1001', warehouse_id: 'KY-DC-01', order_qty: 100, order_date: '2026-10-10', expected_date: '2026-10-20', status: 'Open' },
  { po_id: 'PO-10002', supplier_id: 'SUP-002', sku: 'PPE-2001', warehouse_id: 'KY-DC-01', order_qty: 200, order_date: '2026-10-18', expected_date: '2026-10-30', status: 'Open' },
]
const receipts: GoodsReceipt[] = [{ receipt_id: 'GR-50001', po_id: 'PO-10001', sku: 'UFS-1001', warehouse_id: 'KY-DC-01', received_qty: 80, receipt_date: '2026-10-24' }]
const snap: InventorySnapshot = { snapshot_id: 'INV-90001', sku: 'UFS-1001', warehouse_id: 'KY-DC-01', snapshot_qty: 20, reserved_qty: 5, snapshot_at: '2026-10-23T08:00:00' }

describe('purchase order summary', () => {
  const [s1, s2] = summarizePurchaseOrders(pos, receipts, TODAY)
  it('computes received and remaining quantities', () => {
    expect(s1.receivedQty).toBe(80)
    expect(s1.remainingQty).toBe(20)
    expect(s1.derivedStatus).toBe('Partially Received')
  })
  it('flags overdue and stale status', () => {
    expect(s1.isOverdue).toBe(true)
    expect(s1.daysOverdue).toBe(6)
    expect(s1.statusMismatch).toBe(true)
    expect(s2.isOverdue).toBe(false)
  })
})

describe('receipt validation', () => {
  const [s1] = summarizePurchaseOrders(pos, receipts, TODAY)
  it('accepts a receipt within the remaining quantity', () => {
    expect(validateGoodsReceipt({ po_id: 'PO-10001', received_qty: 20, receipt_date: TODAY }, s1, TODAY).errors).toEqual({})
  })
  it('flags over-receipts with the excess', () => {
    const r = validateGoodsReceipt({ po_id: 'PO-10001', received_qty: 25, receipt_date: TODAY }, s1, TODAY)
    expect(r.overReceiptQty).toBe(5)
    expect(r.errors.received_qty).toMatch(/Over-receipt/)
  })
  it('rejects zero, negative, fractional and missing quantities', () => {
    for (const q of [0, -3, 1.5, NaN]) {
      expect(validateGoodsReceipt({ po_id: 'PO-10001', received_qty: q, receipt_date: TODAY }, s1, TODAY).errors.received_qty).toBeDefined()
    }
  })
  it('rejects future and pre-order receipt dates', () => {
    expect(validateGoodsReceipt({ po_id: 'PO-10001', received_qty: 1, receipt_date: '2026-10-27' }, s1, TODAY).errors.receipt_date).toBeDefined()
    expect(validateGoodsReceipt({ po_id: 'PO-10001', received_qty: 1, receipt_date: '2026-10-01' }, s1, TODAY).errors.receipt_date).toBeDefined()
  })
})

describe('purchase order validation', () => {
  const suppliers = [{ supplier_id: 'SUP-001', supplier_name: 'A', standard_lead_days: 7 }]
  const products = [{ sku: 'UFS-1001', product_name: 'Shirt', category: null, unit_cost: null }]
  it('accepts a complete order', () => {
    expect(validatePurchaseOrder({ supplier_id: 'SUP-001', sku: 'UFS-1001', warehouse_id: 'KY-DC-01', order_qty: 10, expected_date: '2026-11-01' }, suppliers, products, TODAY)).toEqual({})
  })
  it('requires existing supplier/product, positive qty, and future date', () => {
    const e = validatePurchaseOrder({ supplier_id: 'SUP-999', sku: 'NOPE', warehouse_id: '', order_qty: 0, expected_date: '2026-10-01' }, suppliers, products, TODAY)
    expect(Object.keys(e).sort()).toEqual(['expected_date', 'order_qty', 'sku', 'supplier_id', 'warehouse_id'])
  })
})

describe('reconciliation and investigation', () => {
  it('recomputes the view rule (receipts strictly after the snapshot day)', () => {
    expect(recomputeReconciliation(snap, receipts)).toEqual({ receiptAfterSnapshot: 80, adjustedOnHand: 100, adjustedAvailable: 95 })
    const sameDay = [{ ...receipts[0], receipt_date: '2026-10-23' }]
    expect(recomputeReconciliation(snap, sameDay).receiptAfterSnapshot).toBe(0)
  })
  it('flags reserved vs open sales demand and view mismatches', () => {
    const row: ReconciliationRow = { ...snap, sku: 'UFS-1001', product_name: 'Shirt', receipt_after_snapshot: 80, adjusted_on_hand: 100, adjusted_available: 95 }
    const sos: SalesOrder[] = [{ sales_order_id: 'SO-70001', sku: 'UFS-1001', warehouse_id: 'KY-DC-01', order_qty: 12, shipped_qty: 5, order_date: '2026-10-23', status: 'Partially Shipped' }]
    const f = investigate({ row, snapshot: snap, receipts, salesOrders: sos, poSummaries: summarizePurchaseOrders(pos, receipts, TODAY) })
    const titles = f.map((x) => x.title)
    expect(titles).toContain('Open sales demand exceeds reserved stock')
    expect(titles.some((t) => t.includes('overdue'))).toBe(true)
    expect(titles).not.toContain('View and app calculation disagree')
    const bad = investigate({ row: { ...row, adjusted_on_hand: 90 }, snapshot: snap, receipts, salesOrders: sos, poSummaries: [] })
    expect(bad[0].title).toBe('View and app calculation disagree')
  })
})
