import { describe, expect, it } from 'vitest'
import { summarizePurchaseOrders } from './logic'
import { purchaseStage, salesStage } from './stage'
import type { PurchaseOrder, SalesOrder } from './types'

const po = (id: string, qty: number, status: string): PurchaseOrder => ({
  po_id: id, supplier_id: 'SUP-001', sku: 'UFS-1001', warehouse_id: 'KY-DC-01', order_qty: qty, order_date: '2026-10-10', expected_date: '2026-10-20', status,
})
const so = (qty: number, shipped: number, status: string): SalesOrder => ({
  sales_order_id: 'SO-1', sku: 'UFS-1001', warehouse_id: 'KY-DC-01', order_qty: qty, shipped_qty: shipped, order_date: '2026-10-20', status,
})

describe('purchase stage', () => {
  const receipts = [{ receipt_id: 'GR-1', po_id: 'PO-2', sku: 'UFS-1001', warehouse_id: 'KY-DC-01', received_qty: 80, receipt_date: '2026-10-24' },
    { receipt_id: 'GR-2', po_id: 'PO-3', sku: 'UFS-1001', warehouse_id: 'KY-DC-01', received_qty: 50, receipt_date: '2026-10-24' }]
  const s = summarizePurchaseOrders([po('PO-1', 100, 'Open'), po('PO-2', 100, 'Open'), po('PO-3', 50, 'Partially Received'), po('PO-4', 10, 'Draft')], receipts, '2026-10-26')
  it('classifies by real quantities, not stale status text', () => {
    expect(s.map(purchaseStage)).toEqual(['Open', 'Pending', 'Closed', 'Draft'])
  })
})

describe('sales stage', () => {
  it('classifies draft, open, pending, closed', () => {
    expect([so(10, 0, 'Draft'), so(60, 0, 'Open'), so(12, 5, 'Partially Shipped'), so(20, 20, 'Shipped')].map(salesStage)).toEqual(['Draft', 'Open', 'Pending', 'Closed'])
  })
})
