// Screen A: view/search POs, create a PO, record a goods receipt.
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Field } from '../components/Field'
import { Notice } from '../components/Notice'
import { StatusBadge } from '../components/StatusBadge'
import { listGoodsReceipts, recordGoodsReceipt } from '../data/goodsReceipts'
import { listProducts } from '../data/products'
import { createPurchaseOrder, listPurchaseOrders } from '../data/purchaseOrders'
import { listSuppliers } from '../data/suppliers'
import { summarizePurchaseOrders, todayISO, validateGoodsReceipt, validatePurchaseOrder, type PoSummary } from '../lib/logic'
import type { Product, Supplier } from '../lib/types'
import { useLoader } from '../lib/useLoader'

interface Props {
  canWrite: boolean
  refreshKey: number
  onDataChanged: () => void
}

type Result = { kind: 'success' | 'error'; text: string } | null

export function OperationsScreen({ canWrite, refreshKey, onDataChanged }: Props) {
  const today = todayISO()
  const lookups = useLoader(() => Promise.all([listSuppliers(), listProducts()]), [])
  const orders = useLoader(() => Promise.all([listPurchaseOrders(), listGoodsReceipts()]), [refreshKey])

  const [suppliers, products] = lookups.data ?? [[], []]
  const [pos, receipts] = orders.data ?? [[], []]
  const summaries = useMemo(() => summarizePurchaseOrders(pos, receipts, today), [pos, receipts, today])
  const warehouses = useMemo(() => [...new Set(pos.map((p) => p.warehouse_id).filter(Boolean))] as string[], [pos])

  // Bumping the shared refresh key re-reads POs and receipts here and the
  // Inventory screen's view data, so both show the new record.
  const refreshAll = async () => onDataChanged()

  return (
    <div className="stack">
      {lookups.error && <Notice kind="error">{lookups.error}</Notice>}
      <PurchaseOrderTable summaries={summaries} receipts={receipts} loading={orders.loading} error={orders.error} onReload={orders.reload} />
      <div className="grid-2">
        <CreatePoForm
          disabled={!canWrite || lookups.loading}
          suppliers={suppliers}
          products={products}
          warehouses={warehouses}
          today={today}
          onCreated={refreshAll}
        />
        <ReceiptForm disabled={!canWrite || orders.loading} summaries={summaries} today={today} onRecorded={refreshAll} />
      </div>
      {!canWrite && (
        <Notice kind="info">You are signed in read-only. Ask an administrator to give your account the "operator" ERP role to create POs and receipts.</Notice>
      )}
    </div>
  )
}

// ---------- PO list ----------

function poTone(s: PoSummary): 'neutral' | 'good' | 'warn' | 'bad' {
  if (s.derivedStatus === 'Over-received') return 'bad'
  if (s.isOverdue) return 'bad'
  if (s.derivedStatus === 'Received') return 'good'
  if (s.derivedStatus === 'Partially Received') return 'warn'
  return 'neutral'
}

function PurchaseOrderTable(props: {
  summaries: PoSummary[]
  receipts: { receipt_id: string; po_id: string | null; received_qty: number | null; receipt_date: string | null }[]
  loading: boolean
  error: string | null
  onReload: () => void
}) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const rows = props.summaries.filter((s) => {
    const hay = [s.po.po_id, s.po.supplier_id, s.po.sku, s.po.warehouse_id, s.po.status].join(' ').toLowerCase()
    if (q && !hay.includes(q)) return false
    if (statusFilter === 'open') return s.isOpen
    if (statusFilter === 'overdue') return s.isOverdue
    if (statusFilter === 'closed') return !s.isOpen
    return true
  })

  return (
    <section className="card">
      <header className="card-header">
        <h2>Purchase orders</h2>
        <div className="toolbar">
          <input type="search" placeholder="Search PO, supplier, SKU, warehouse…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search purchase orders" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="overdue">Overdue</option>
            <option value="closed">Fully received / closed</option>
          </select>
          <button type="button" onClick={props.onReload} disabled={props.loading}>
            Refresh
          </button>
        </div>
      </header>
      {props.loading && <Notice kind="loading">Loading purchase orders from Supabase…</Notice>}
      {props.error && <Notice kind="error">{props.error}</Notice>}
      {!props.loading && !props.error && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PO</th>
                <th>Supplier</th>
                <th>SKU</th>
                <th>Warehouse</th>
                <th className="num">Ordered</th>
                <th className="num">Received</th>
                <th className="num">Remaining</th>
                <th>Expected</th>
                <th>Stored status</th>
                <th>Derived status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="empty">
                    No purchase orders match.
                  </td>
                </tr>
              )}
              {rows.map((s) => (
                <PoRow key={s.po.po_id} s={s} receipts={props.receipts} open={expanded === s.po.po_id} onToggle={() => setExpanded(expanded === s.po.po_id ? null : s.po.po_id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function PoRow({ s, receipts, open, onToggle }: { s: PoSummary; receipts: Parameters<typeof PurchaseOrderTable>[0]['receipts']; open: boolean; onToggle: () => void }) {
  const poReceipts = receipts.filter((r) => r.po_id === s.po.po_id)
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td>
          <span className="mono">{s.po.po_id}</span>
        </td>
        <td>{s.po.supplier_id}</td>
        <td className="mono">{s.po.sku}</td>
        <td className="mono">{s.po.warehouse_id}</td>
        <td className="num">{s.po.order_qty}</td>
        <td className="num">{s.receivedQty}</td>
        <td className="num">{s.remainingQty}</td>
        <td>
          {s.po.expected_date}
          {s.isOverdue && <StatusBadge tone="bad" text={`${s.daysOverdue}d overdue`} />}
        </td>
        <td>
          {s.po.status}
          {s.statusMismatch && <StatusBadge tone="warn" text="stale" />}
        </td>
        <td>
          <StatusBadge tone={poTone(s)} text={s.derivedStatus} />
        </td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={10}>
            {poReceipts.length === 0
              ? 'No goods receipts recorded against this PO yet.'
              : poReceipts.map((r) => (
                  <div key={r.receipt_id}>
                    <span className="mono">{r.receipt_id}</span>: {r.received_qty} units on {r.receipt_date}
                  </div>
                ))}
          </td>
        </tr>
      )}
    </>
  )
}

// ---------- Create PO ----------

function CreatePoForm(props: {
  disabled: boolean
  suppliers: Supplier[]
  products: Product[]
  warehouses: string[]
  today: string
  onCreated: () => Promise<void>
}) {
  const [form, setForm] = useState({ supplier_id: '', sku: '', warehouse_id: '', order_qty: '', expected_date: '' })
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<Result>(null)
  // A ref updates instantly, so a fast double-click can't send the form twice
  // (React state only updates on the next render).
  const inFlight = useRef(false)

  const input = { ...form, warehouse_id: form.warehouse_id.trim().toUpperCase(), order_qty: form.order_qty === '' ? NaN : Number(form.order_qty) }
  const errors = validatePurchaseOrder(input, props.suppliers, props.products, props.today)
  const valid = Object.keys(errors).length === 0
  const shown = touched ? errors : {}

  // Suggest an expected date from the supplier's standard lead time.
  const supplier = props.suppliers.find((s) => s.supplier_id === form.supplier_id)
  const suggestedDate = supplier?.standard_lead_days != null ? addDays(props.today, supplier.standard_lead_days) : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    setResult(null)
    if (!valid || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    try {
      const po = await createPurchaseOrder(input)
      setResult({ kind: 'success', text: `Created ${po.po_id}: ${po.order_qty} × ${po.sku} for ${po.warehouse_id}, due ${po.expected_date}.` })
      setForm({ supplier_id: '', sku: '', warehouse_id: '', order_qty: '', expected_date: '' })
      setTouched(false)
      await props.onCreated()
    } catch (err) {
      setResult({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  return (
    <section className="card">
      <header className="card-header">
        <h2>Create purchase order</h2>
      </header>
      <form onSubmit={submit} noValidate className="form">
        <Field label="Supplier" error={shown.supplier_id}>
          <select value={form.supplier_id} onChange={set('supplier_id')} disabled={props.disabled}>
            <option value="">Select a supplier…</option>
            {props.suppliers.map((s) => (
              <option key={s.supplier_id} value={s.supplier_id}>
                {s.supplier_id} · {s.supplier_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Product (SKU)" error={shown.sku}>
          <select value={form.sku} onChange={set('sku')} disabled={props.disabled}>
            <option value="">Select a product…</option>
            {props.products.map((p) => (
              <option key={p.sku} value={p.sku}>
                {p.sku} · {p.product_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Warehouse" error={shown.warehouse_id} hint="Existing warehouses are suggested; new codes are allowed.">
          <input list="warehouse-options" value={form.warehouse_id} onChange={set('warehouse_id')} placeholder="e.g. KY-DC-01" disabled={props.disabled} />
          <datalist id="warehouse-options">
            {props.warehouses.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
        </Field>
        <Field label="Order quantity" error={shown.order_qty}>
          <input type="number" min={1} step={1} inputMode="numeric" value={form.order_qty} onChange={set('order_qty')} disabled={props.disabled} />
        </Field>
        <Field
          label="Expected delivery date"
          error={shown.expected_date}
          hint={
            suggestedDate && (
              <>
                {supplier!.supplier_name} lead time is {supplier!.standard_lead_days} days.{' '}
                <button type="button" className="link" onClick={() => setForm({ ...form, expected_date: suggestedDate })}>
                  Use {suggestedDate}
                </button>
              </>
            )
          }
        >
          <input type="date" min={props.today} value={form.expected_date} onChange={set('expected_date')} disabled={props.disabled} />
        </Field>
        <p className="muted small">The PO number, order date (today) and status "Open" are set by the database.</p>
        <button type="submit" className="primary" disabled={props.disabled || saving}>
          {saving ? 'Saving…' : 'Create purchase order'}
        </button>
        {saving && <Notice kind="loading">Saving to Supabase…</Notice>}
        {result && (
          <Notice kind={result.kind} onClose={() => setResult(null)}>
            {result.text}
          </Notice>
        )}
      </form>
    </section>
  )
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return todayISO(d)
}

// ---------- Record goods receipt ----------

function ReceiptForm(props: { disabled: boolean; summaries: PoSummary[]; today: string; onRecorded: () => Promise<void> }) {
  const [form, setForm] = useState({ po_id: '', received_qty: '', receipt_date: props.today })
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<Result>(null)
  // A ref updates instantly, so a fast double-click can't send the form twice
  // (React state only updates on the next render).
  const inFlight = useRef(false)

  const summary = props.summaries.find((s) => s.po.po_id === form.po_id)
  const input = { ...form, received_qty: form.received_qty === '' ? NaN : Number(form.received_qty) }
  const { errors, overReceiptQty } = validateGoodsReceipt(input, summary, props.today)
  const valid = Object.keys(errors).length === 0
  // Over-receipt is shown immediately (not only after submit) so it can't be missed.
  const shown = touched ? errors : overReceiptQty > 0 ? { received_qty: errors.received_qty } : {}

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    setResult(null)
    if (!valid || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    try {
      const gr = await recordGoodsReceipt(input)
      setResult({ kind: 'success', text: `Recorded ${gr.receipt_id}: ${gr.received_qty} × ${gr.sku} received at ${gr.warehouse_id} on ${gr.receipt_date} against ${gr.po_id}.` })
      setForm({ po_id: '', received_qty: '', receipt_date: props.today })
      setTouched(false)
      await props.onRecorded()
    } catch (err) {
      setResult({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const sorted = [...props.summaries].sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || a.po.po_id.localeCompare(b.po.po_id))

  return (
    <section className="card">
      <header className="card-header">
        <h2>Record goods receipt</h2>
      </header>
      <form onSubmit={submit} noValidate className="form">
        <Field label="Purchase order" error={shown.po_id}>
          <select value={form.po_id} onChange={set('po_id')} disabled={props.disabled}>
            <option value="">Select a purchase order…</option>
            {sorted.map((s) => (
              <option key={s.po.po_id} value={s.po.po_id}>
                {s.po.po_id} · {s.po.sku} @ {s.po.warehouse_id} · {s.isOpen ? `${s.remainingQty} open` : 'fully received'}
              </option>
            ))}
          </select>
        </Field>
        {summary && (
          <div className="po-facts">
            <div>
              <span>Ordered</span>
              <strong>{summary.po.order_qty}</strong>
            </div>
            <div>
              <span>Already received</span>
              <strong>{summary.receivedQty}</strong>
            </div>
            <div>
              <span>Remaining</span>
              <strong>{summary.remainingQty}</strong>
            </div>
            <div>
              <span>SKU / warehouse</span>
              <strong className="mono">
                {summary.po.sku} @ {summary.po.warehouse_id}
              </strong>
            </div>
          </div>
        )}
        <Field label="Received quantity" error={shown.received_qty}>
          <input type="number" min={1} step={1} inputMode="numeric" value={form.received_qty} onChange={set('received_qty')} disabled={props.disabled} />
        </Field>
        <Field label="Receipt date" error={shown.receipt_date}>
          <input type="date" max={props.today} value={form.receipt_date} onChange={set('receipt_date')} disabled={props.disabled} />
        </Field>
        <p className="muted small">
          A receipt is an operational transaction. It does <strong>not</strong> change the inventory snapshot; the Inventory screen's adjusted quantities
          are recalculated by the reporting view.
        </p>
        <button type="submit" className="primary" disabled={props.disabled || saving || overReceiptQty > 0}>
          {saving ? 'Saving…' : 'Record receipt'}
        </button>
        {saving && <Notice kind="loading">Saving to Supabase…</Notice>}
        {result && (
          <Notice kind={result.kind} onClose={() => setResult(null)}>
            {result.text}
          </Notice>
        )}
      </form>
    </section>
  )
}
