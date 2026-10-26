// Pure business rules: no database calls here, so they are easy to test.
import type {
  GoodsReceipt,
  InventorySnapshot,
  NewGoodsReceipt,
  NewPurchaseOrder,
  Product,
  PurchaseOrder,
  ReconciliationRow,
  SalesOrder,
  Supplier,
} from './types'

export const MAX_QTY = 1_000_000

/** Today's date as YYYY-MM-DD in the user's local time zone. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000)
}

// ---------- Purchase order status ----------

export interface PoSummary {
  po: PurchaseOrder
  receivedQty: number
  remainingQty: number
  /** Status implied by the receipts, independent of the stored status text. */
  derivedStatus: 'Open' | 'Partially Received' | 'Received' | 'Over-received'
  isOpen: boolean
  isOverdue: boolean
  daysOverdue: number
  /** The stored status disagrees with what the receipts say. */
  statusMismatch: boolean
}

export function summarizePurchaseOrders(pos: PurchaseOrder[], receipts: GoodsReceipt[], today: string): PoSummary[] {
  const receivedByPo = new Map<string, number>()
  for (const r of receipts) {
    if (!r.po_id) continue
    receivedByPo.set(r.po_id, (receivedByPo.get(r.po_id) ?? 0) + (r.received_qty ?? 0))
  }
  return pos.map((po) => {
    const ordered = po.order_qty ?? 0
    const receivedQty = receivedByPo.get(po.po_id) ?? 0
    const remainingQty = ordered - receivedQty
    const derivedStatus: PoSummary['derivedStatus'] =
      receivedQty === 0 ? 'Open' : remainingQty > 0 ? 'Partially Received' : remainingQty === 0 ? 'Received' : 'Over-received'
    const stored = (po.status ?? '').trim().toLowerCase()
    const cancelledOrClosed = stored === 'cancelled' || stored === 'closed'
    const isOpen = !cancelledOrClosed && remainingQty > 0
    const daysOverdue = isOpen && po.expected_date ? Math.max(0, daysBetween(po.expected_date, today)) : 0
    return {
      po,
      receivedQty,
      remainingQty,
      derivedStatus,
      isOpen,
      isOverdue: daysOverdue > 0,
      daysOverdue,
      statusMismatch: !cancelledOrClosed && stored !== derivedStatus.toLowerCase(),
    }
  })
}

// ---------- Form validation ----------

export type FieldErrors = Partial<Record<string, string>>

function checkQty(value: number, label: string): string | undefined {
  if (!Number.isFinite(value)) return `${label} is required.`
  if (!Number.isInteger(value)) return `${label} must be a whole number.`
  if (value <= 0) return `${label} must be greater than zero.`
  if (value > MAX_QTY) return `${label} looks too large (max ${MAX_QTY.toLocaleString()}).`
  return undefined
}

export function validatePurchaseOrder(
  input: Partial<NewPurchaseOrder>,
  suppliers: Supplier[],
  products: Product[],
  today: string,
): FieldErrors {
  const errors: FieldErrors = {}
  if (!input.supplier_id) errors.supplier_id = 'Choose a supplier.'
  else if (!suppliers.some((s) => s.supplier_id === input.supplier_id)) errors.supplier_id = 'That supplier does not exist.'
  if (!input.sku) errors.sku = 'Choose a product.'
  else if (!products.some((p) => p.sku === input.sku)) errors.sku = 'That product does not exist.'
  if (!input.warehouse_id?.trim()) errors.warehouse_id = 'Enter a warehouse.'
  else if (!/^[A-Z0-9-]{2,20}$/.test(input.warehouse_id.trim())) errors.warehouse_id = 'Use letters, digits and dashes, e.g. KY-DC-01.'
  const qtyError = checkQty(input.order_qty ?? NaN, 'Order quantity')
  if (qtyError) errors.order_qty = qtyError
  if (!input.expected_date) errors.expected_date = 'Choose an expected delivery date.'
  else if (input.expected_date < today) errors.expected_date = 'Expected date cannot be in the past.'
  return errors
}

export interface ReceiptCheck {
  errors: FieldErrors
  /** Units above the remaining open quantity, or 0. */
  overReceiptQty: number
}

export function validateGoodsReceipt(input: Partial<NewGoodsReceipt>, summary: PoSummary | undefined, today: string): ReceiptCheck {
  const errors: FieldErrors = {}
  let overReceiptQty = 0
  if (!input.po_id) errors.po_id = 'Choose a purchase order.'
  else if (!summary) errors.po_id = 'That purchase order does not exist.'
  const qtyError = checkQty(input.received_qty ?? NaN, 'Received quantity')
  if (qtyError) errors.received_qty = qtyError
  else if (summary) {
    if (summary.remainingQty <= 0) {
      overReceiptQty = input.received_qty!
      errors.received_qty = `Over-receipt: ${summary.po.po_id} is already fully received (${summary.receivedQty} of ${summary.po.order_qty}).`
    } else if (input.received_qty! > summary.remainingQty) {
      overReceiptQty = input.received_qty! - summary.remainingQty
      errors.received_qty = `Over-receipt: only ${summary.remainingQty} remain open on ${summary.po.po_id}; this is ${overReceiptQty} too many.`
    }
  }
  if (!input.receipt_date) errors.receipt_date = 'Choose the receipt date.'
  else if (input.receipt_date > today) errors.receipt_date = 'Receipt date cannot be in the future.'
  else if (summary?.po.order_date && input.receipt_date < summary.po.order_date) errors.receipt_date = 'Receipt date cannot be before the order date.'
  return { errors, overReceiptQty }
}

// ---------- Reconciliation cross-check (Stage 6) ----------

export interface IndependentCalc {
  receiptAfterSnapshot: number
  adjustedOnHand: number
  adjustedAvailable: number
}

/**
 * Recomputes the view's numbers in the browser from the raw rows, using the
 * same rule the view uses: receipts at the same SKU + warehouse dated
 * strictly after the snapshot's day. If this disagrees with the view, the app
 * flags it.
 */
export function recomputeReconciliation(snap: InventorySnapshot, receipts: GoodsReceipt[]): IndependentCalc {
  const snapDay = snap.snapshot_at?.slice(0, 10) ?? ''
  const receiptAfterSnapshot = receipts
    .filter((r) => r.sku === snap.sku && r.warehouse_id === snap.warehouse_id && (r.receipt_date ?? '') > snapDay)
    .reduce((sum, r) => sum + (r.received_qty ?? 0), 0)
  const adjustedOnHand = (snap.snapshot_qty ?? 0) + receiptAfterSnapshot
  return { receiptAfterSnapshot, adjustedOnHand, adjustedAvailable: adjustedOnHand - (snap.reserved_qty ?? 0) }
}

// ---------- Discrepancy investigation ----------

export type Severity = 'high' | 'medium' | 'info'

export interface Finding {
  severity: Severity
  title: string
  detail: string
  recommendation: string
}

export interface InvestigationInput {
  row: ReconciliationRow
  snapshot?: InventorySnapshot
  receipts: GoodsReceipt[]
  salesOrders: SalesOrder[]
  poSummaries: PoSummary[]
}

export function investigate({ row, snapshot, receipts, salesOrders, poSummaries }: InvestigationInput): Finding[] {
  const findings: Finding[] = []
  const sameLocation = <T extends { sku: string | null; warehouse_id: string | null }>(x: T) =>
    x.sku === row.sku && x.warehouse_id === row.warehouse_id
  const snapDay = row.snapshot_at?.slice(0, 10) ?? ''

  // 1. Does the view agree with an independent recalculation?
  if (snapshot) {
    const calc = recomputeReconciliation(snapshot, receipts)
    if (calc.adjustedOnHand !== row.adjusted_on_hand || calc.adjustedAvailable !== row.adjusted_available) {
      findings.push({
        severity: 'high',
        title: 'View and app calculation disagree',
        detail: `View: on-hand ${row.adjusted_on_hand}, available ${row.adjusted_available}. Recalculated from raw rows: on-hand ${calc.adjustedOnHand}, available ${calc.adjustedAvailable}.`,
        recommendation: 'Compare the view definition with the raw receipts for this SKU/warehouse before trusting either number.',
      })
    }
  }

  // 2. Reserved quantity vs open sales orders.
  const locSOs = salesOrders.filter(sameLocation)
  const openSoQty = locSOs.reduce((sum, so) => sum + Math.max(0, (so.order_qty ?? 0) - (so.shipped_qty ?? 0)), 0)
  const reserved = row.reserved_qty ?? 0
  if (reserved !== openSoQty) {
    const soList = locSOs.map((so) => `${so.sales_order_id} (${so.order_qty ?? 0} ordered, ${so.shipped_qty ?? 0} shipped)`).join(', ') || 'none'
    findings.push({
      severity: 'medium',
      title: reserved > openSoQty ? 'Reserved stock exceeds open sales demand' : 'Open sales demand exceeds reserved stock',
      detail: `Snapshot reserves ${reserved}, but open (unshipped) sales-order quantity is ${openSoQty}. Sales orders: ${soList}.`,
      recommendation:
        reserved > openSoQty
          ? 'Check for stale reservations (orders shipped or cancelled after reserving). Release them so available stock is not understated.'
          : 'Check whether reservations were made after the snapshot; available stock may be overstated until they are applied.',
    })
  }

  // 3. Shipments after the snapshot are not subtracted by the view.
  const shippedAfter = locSOs.filter((so) => (so.order_date ?? '') >= snapDay && (so.shipped_qty ?? 0) > 0)
  if (shippedAfter.length > 0) {
    const qty = shippedAfter.reduce((s, so) => s + (so.shipped_qty ?? 0), 0)
    findings.push({
      severity: 'info',
      title: 'Possible outbound movement after the snapshot',
      detail: `${qty} unit(s) were shipped on sales orders dated on/after the snapshot day (${shippedAfter.map((s) => s.sales_order_id).join(', ')}). The view adds later receipts but does not subtract later shipments.`,
      recommendation: 'Confirm ship dates; if they fall after the snapshot, adjusted on-hand is overstated by that amount. Consider adding shipments to the reporting logic.',
    })
  }

  // 4. Receipts on the snapshot day are excluded by the view's ">" rule.
  const sameDay = receipts.filter((r) => sameLocation(r) && r.receipt_date === snapDay)
  if (sameDay.length > 0) {
    findings.push({
      severity: 'medium',
      title: 'Receipt on the snapshot day is not counted',
      detail: `${sameDay.map((r) => `${r.receipt_id} (${r.received_qty})`).join(', ')} dated ${snapDay}. Receipts have no time, so the view cannot tell if they arrived before or after the ${row.snapshot_at?.slice(11, 16)} count.`,
      recommendation: 'Verify with the warehouse whether the count included this delivery; consider storing a receipt timestamp.',
    })
  }

  // 5. Inbound POs for this SKU/warehouse: overdue or with stale status.
  for (const s of poSummaries.filter((s) => sameLocation(s.po))) {
    if (s.isOverdue) {
      findings.push({
        severity: 'medium',
        title: `${s.po.po_id} is overdue by ${s.daysOverdue} day(s)`,
        detail: `${s.remainingQty} of ${s.po.order_qty} units still expected (due ${s.po.expected_date}).`,
        recommendation: `Contact supplier ${s.po.supplier_id} for a new delivery date; don't count these ${s.remainingQty} units as available yet.`,
      })
    }
    if (s.statusMismatch) {
      findings.push({
        severity: 'info',
        title: `${s.po.po_id} status looks stale`,
        detail: `Stored status is "${s.po.status}", but receipts show ${s.receivedQty} of ${s.po.order_qty} received (${s.derivedStatus}).`,
        recommendation: 'Update the PO status so open-PO reports and buyers see the real position.',
      })
    }
  }

  // 6. Negative available is always a red flag.
  if ((row.adjusted_available ?? 0) < 0) {
    findings.push({
      severity: 'high',
      title: 'Negative available quantity',
      detail: `Adjusted available is ${row.adjusted_available}: more is reserved than is on hand.`,
      recommendation: 'Do a cycle count and review reservations before promising more stock.',
    })
  }

  return findings
}
