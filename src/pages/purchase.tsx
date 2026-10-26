// Purchase module task pages: all orders, new order, product receipt.
import { useMemo, useState, type FormEvent } from 'react'
import { Field } from '../components/Field'
import { Notice } from '../components/Notice'
import { StatusBadge } from '../components/StatusBadge'
import { useErpData } from '../data/ErpData'
import { recordGoodsReceipt } from '../data/goodsReceipts'
import { confirmPurchaseOrder, createPurchaseOrder, savePurchaseOrderDraft } from '../data/purchaseOrders'
import { todayISO, validateGoodsReceipt, validatePurchaseOrder, type PoSummary } from '../lib/logic'
import { purchaseStage, stageTone, STAGES, type Stage } from '../lib/stage'
import { DataGrid, FastTab, Page, StageFilter, type Column } from '../shell/Page'
import { useSubmit } from '../shell/useSubmit'

export function poColumns(): Column<PoSummary>[] {
  return [
    { key: 'po', header: 'Purchase order', render: (s) => <span className="mono link-text">{s.po.po_id}</span>, sortValue: (s) => s.po.po_id },
    { key: 'vendor', header: 'Vendor', render: (s) => s.po.supplier_id, sortValue: (s) => s.po.supplier_id },
    { key: 'sku', header: 'Item', render: (s) => <span className="mono">{s.po.sku}</span>, sortValue: (s) => s.po.sku },
    { key: 'wh', header: 'Warehouse', render: (s) => <span className="mono">{s.po.warehouse_id}</span>, sortValue: (s) => s.po.warehouse_id },
    { key: 'qty', header: 'Ordered', render: (s) => s.po.order_qty, sortValue: (s) => s.po.order_qty, numeric: true },
    { key: 'rec', header: 'Received', render: (s) => s.receivedQty, sortValue: (s) => s.receivedQty, numeric: true },
    { key: 'rem', header: 'Remaining', render: (s) => s.remainingQty, sortValue: (s) => s.remainingQty, numeric: true },
    { key: 'ord', header: 'Order date', render: (s) => s.po.order_date, sortValue: (s) => s.po.order_date },
    {
      key: 'exp',
      header: 'Delivery date',
      render: (s) => (
        <>
          {s.po.expected_date}
          {s.isOverdue && <StatusBadge tone="bad" text={`${s.daysOverdue}d late`} />}
        </>
      ),
      sortValue: (s) => s.po.expected_date,
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => (
        <>
          {s.po.status}
          {s.statusMismatch && <StatusBadge tone="warn" text="stale" />}
        </>
      ),
      sortValue: (s) => s.po.status,
    },
    { key: 'stage', header: 'Order type', render: (s) => <StatusBadge tone={stageTone(purchaseStage(s))} text={purchaseStage(s)} />, sortValue: (s) => STAGES.indexOf(purchaseStage(s)) },
  ]
}

// ---------- All purchase orders ----------

export function PurchaseOrdersPage({ route, canWrite }: { route: string; canWrite: boolean }) {
  const { data, loading, reload } = useErpData()
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage | 'All'>('All')
  const [selected, setSelected] = useState<string | null>(null)
  const submit = useSubmit()

  const all = data?.poSummaries ?? []
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, all.filter((x) => purchaseStage(x) === s).length])) as Record<Stage, number>, [all])
  const q = query.trim().toLowerCase()
  const rows = all.filter((s) => (stage === 'All' || purchaseStage(s) === stage) && (!q || [s.po.po_id, s.po.supplier_id, s.po.sku, s.po.warehouse_id, s.po.status].join(' ').toLowerCase().includes(q)))
  const sel = all.find((s) => s.po.po_id === selected) ?? null
  const supplier = data?.suppliers.find((x) => x.supplier_id === sel?.po.supplier_id)
  const product = data?.products.find((x) => x.sku === sel?.po.sku)
  const receipts = data?.receipts.filter((r) => r.po_id === sel?.po.po_id) ?? []
  const isDraft = sel && purchaseStage(sel) === 'Draft'

  const confirm = () =>
    sel &&
    submit.run(async () => {
      const po = await confirmPurchaseOrder(sel.po.po_id)
      await reload()
      return `${po.po_id} confirmed. Status is now ${po.status}.`
    })

  return (
    <Page
      route={route}
      title="All purchase orders"
      actions={[
        { label: 'New', icon: 'plus', to: 'purchase/new', disabled: !canWrite, primary: true },
        { label: 'Confirm', icon: 'check', onClick: confirm, disabled: !canWrite || !isDraft || submit.saving, title: 'Confirm the selected draft PO' },
        { label: 'Product receipt', icon: 'receive', to: 'purchase/receipt', disabled: !canWrite },
        { label: 'Refresh', icon: 'refresh', onClick: () => void reload(), disabled: loading },
      ]}
    >
      <div className="filter-bar">
        <input type="search" placeholder="Filter by PO, vendor, item, warehouse…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter purchase orders" />
        <StageFilter value={stage} onChange={setStage} counts={counts} />
      </div>
      {submit.result && (
        <Notice kind={submit.result.kind} onClose={() => submit.setResult(null)}>
          {submit.result.text}
        </Notice>
      )}
      <DataGrid columns={poColumns()} rows={rows} rowKey={(s) => s.po.po_id} selectedKey={selected} onSelect={(s) => setSelected(s.po.po_id)} empty="No purchase orders match." />
      {sel && (
        <div className="details">
          <FastTab title={`Purchase order ${sel.po.po_id}`} summary={`${sel.po.supplier_id} · ${sel.po.status}`}>
            <dl className="facts">
              <div><dt>Vendor</dt><dd>{sel.po.supplier_id} · {supplier?.supplier_name}</dd></div>
              <div><dt>Order date</dt><dd>{sel.po.order_date}</dd></div>
              <div><dt>Delivery date</dt><dd>{sel.po.expected_date}{sel.isOverdue && ` (${sel.daysOverdue} days late)`}</dd></div>
              <div><dt>Stored status</dt><dd>{sel.po.status}</dd></div>
              <div><dt>Order type</dt><dd>{purchaseStage(sel)}</dd></div>
            </dl>
            {sel.statusMismatch && <Notice kind="warning">Stored status "{sel.po.status}" doesn't match the receipts ({sel.derivedStatus}).</Notice>}
          </FastTab>
          <FastTab title="Line" summary={`${sel.po.order_qty} × ${sel.po.sku}`}>
            <dl className="facts">
              <div><dt>Item</dt><dd>{sel.po.sku} · {product?.product_name}</dd></div>
              <div><dt>Warehouse</dt><dd>{sel.po.warehouse_id}</dd></div>
              <div><dt>Quantity</dt><dd>{sel.po.order_qty}</dd></div>
              <div><dt>Unit cost</dt><dd>{product?.unit_cost != null ? product.unit_cost.toFixed(2) : '—'}</dd></div>
              <div><dt>Line amount</dt><dd>{product?.unit_cost != null && sel.po.order_qty != null ? (product.unit_cost * sel.po.order_qty).toFixed(2) : '—'}</dd></div>
            </dl>
          </FastTab>
          <FastTab title="Product receipts" summary={`${sel.receivedQty} of ${sel.po.order_qty} received`}>
            {receipts.length === 0 ? (
              <p className="muted">No goods received against this order yet.</p>
            ) : (
              <ul className="plain">
                {receipts.map((r) => (
                  <li key={r.receipt_id}>
                    <span className="mono">{r.receipt_id}</span>: {r.received_qty} units on {r.receipt_date}
                  </li>
                ))}
              </ul>
            )}
          </FastTab>
        </div>
      )}
    </Page>
  )
}

// ---------- New purchase order ----------

const EMPTY_PO = { supplier_id: '', sku: '', warehouse_id: '', order_qty: '', expected_date: '' }

export function NewPurchaseOrderPage({ route, canWrite }: { route: string; canWrite: boolean }) {
  const { data, reload } = useErpData()
  const today = todayISO()
  const [form, setForm] = useState(EMPTY_PO)
  const [touched, setTouched] = useState(false)
  const submit = useSubmit()
  const suppliers = data?.suppliers ?? []
  const products = data?.products ?? []

  const input = { ...form, warehouse_id: form.warehouse_id.trim().toUpperCase(), order_qty: form.order_qty === '' ? NaN : Number(form.order_qty) }
  const errors = validatePurchaseOrder(input, suppliers, products, today)
  const valid = Object.keys(errors).length === 0
  const shown = touched ? errors : {}
  const supplier = suppliers.find((s) => s.supplier_id === form.supplier_id)
  const product = products.find((p) => p.sku === form.sku)
  const suggested = supplier?.standard_lead_days != null ? addDays(today, supplier.standard_lead_days) : null
  const lineAmount = product?.unit_cost != null && Number.isFinite(input.order_qty) ? product.unit_cost * input.order_qty : null

  const save = (asDraft: boolean) => (e?: FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (!valid) return
    void submit.run(async () => {
      const po = asDraft ? await savePurchaseOrderDraft(input) : await createPurchaseOrder(input)
      setForm(EMPTY_PO)
      setTouched(false)
      await reload()
      return asDraft
        ? `Draft ${po.po_id} saved (${po.order_qty} × ${po.sku}). Confirm it from All purchase orders when ready.`
        : `Purchase order ${po.po_id} created: ${po.order_qty} × ${po.sku} for ${po.warehouse_id}, delivery ${po.expected_date}.`
    })
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const disabled = !canWrite || submit.saving

  return (
    <Page
      route={route}
      title="New purchase order"
      subtitle="The PO number, order date and status are set by the database."
      actions={[
        { label: 'Confirm order', icon: 'check', onClick: save(false), disabled, primary: true },
        { label: 'Save as draft', icon: 'list', onClick: save(true), disabled },
        { label: 'All purchase orders', icon: 'list', to: 'purchase/orders' },
      ]}
    >
      {!canWrite && <Notice kind="info">Your account is read-only. Ask an administrator for the operator role to raise purchase orders.</Notice>}
      <form onSubmit={save(false)} noValidate>
        <FastTab title="Vendor" summary={supplier ? `${supplier.supplier_id} · ${supplier.supplier_name}` : undefined}>
          <div className="form-grid">
            <Field label="Vendor account" error={shown.supplier_id}>
              <select value={form.supplier_id} onChange={set('supplier_id')} disabled={disabled}>
                <option value="">Select a vendor…</option>
                {suppliers.map((s) => (
                  <option key={s.supplier_id} value={s.supplier_id}>
                    {s.supplier_id} · {s.supplier_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lead time">
              <input value={supplier?.standard_lead_days != null ? `${supplier.standard_lead_days} days` : ''} readOnly placeholder="—" />
            </Field>
          </div>
        </FastTab>
        <FastTab title="Purchase order line" summary={product ? `${form.order_qty || '?'} × ${product.sku}` : undefined}>
          <div className="form-grid">
            <Field label="Item number" error={shown.sku}>
              <select value={form.sku} onChange={set('sku')} disabled={disabled}>
                <option value="">Select an item…</option>
                {products.map((p) => (
                  <option key={p.sku} value={p.sku}>
                    {p.sku} · {p.product_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Warehouse" error={shown.warehouse_id} hint="Pick an existing site or type a new code.">
              <input list="po-warehouses" value={form.warehouse_id} onChange={set('warehouse_id')} placeholder="e.g. KY-DC-01" disabled={disabled} />
              <datalist id="po-warehouses">
                {data?.warehouses.map((w) => <option key={w} value={w} />)}
              </datalist>
            </Field>
            <Field label="Quantity" error={shown.order_qty}>
              <input type="number" min={1} step={1} inputMode="numeric" value={form.order_qty} onChange={set('order_qty')} disabled={disabled} />
            </Field>
            <Field label="Unit price">
              <input value={product?.unit_cost != null ? product.unit_cost.toFixed(2) : ''} readOnly placeholder="—" />
            </Field>
            <Field label="Line amount">
              <input value={lineAmount != null ? lineAmount.toFixed(2) : ''} readOnly placeholder="—" />
            </Field>
          </div>
        </FastTab>
        <FastTab title="Delivery" summary={form.expected_date || undefined}>
          <div className="form-grid">
            <Field
              label="Requested delivery date"
              error={shown.expected_date}
              hint={
                suggested && (
                  <button type="button" className="link" onClick={() => setForm({ ...form, expected_date: suggested })}>
                    Use vendor lead time: {suggested}
                  </button>
                )
              }
            >
              <input type="date" min={today} value={form.expected_date} onChange={set('expected_date')} disabled={disabled} />
            </Field>
          </div>
        </FastTab>
        <div className="form-footer">
          <button type="submit" className="primary" disabled={disabled}>
            {submit.saving ? 'Saving…' : 'Confirm order'}
          </button>
          <button type="button" onClick={save(true)} disabled={disabled}>
            Save as draft
          </button>
        </div>
        {submit.saving && <Notice kind="loading">Saving to Supabase…</Notice>}
        {submit.result && (
          <Notice kind={submit.result.kind} onClose={() => submit.setResult(null)}>
            {submit.result.text}
          </Notice>
        )}
      </form>
    </Page>
  )
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return todayISO(d)
}

// ---------- Product receipt ----------

export function ProductReceiptPage({ route, canWrite }: { route: string; canWrite: boolean }) {
  const { data, reload } = useErpData()
  const today = todayISO()
  const [form, setForm] = useState({ po_id: '', received_qty: '', receipt_date: today })
  const [touched, setTouched] = useState(false)
  const submit = useSubmit()

  // Drafts aren't sent to the vendor yet, so they can't be received against.
  const candidates = (data?.poSummaries ?? []).filter((s) => purchaseStage(s) !== 'Draft').sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || a.po.po_id.localeCompare(b.po.po_id))
  const summary = candidates.find((s) => s.po.po_id === form.po_id)
  const input = { ...form, received_qty: form.received_qty === '' ? NaN : Number(form.received_qty) }
  const { errors, overReceiptQty } = validateGoodsReceipt(input, summary, today)
  const valid = Object.keys(errors).length === 0
  // Over-receipt is shown immediately so it can't be missed.
  const shown = touched ? errors : overReceiptQty > 0 ? { received_qty: errors.received_qty } : {}
  const disabled = !canWrite || submit.saving

  const save = (e?: FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (!valid) return
    void submit.run(async () => {
      const gr = await recordGoodsReceipt(input)
      setForm({ po_id: '', received_qty: '', receipt_date: today })
      setTouched(false)
      await reload()
      return `Product receipt ${gr.receipt_id} posted: ${gr.received_qty} × ${gr.sku} into ${gr.warehouse_id} on ${gr.receipt_date} against ${gr.po_id}.`
    })
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  return (
    <Page
      route={route}
      title="Product receipt"
      subtitle="Record goods received against a confirmed purchase order."
      actions={[
        { label: 'Post receipt', icon: 'check', onClick: save, disabled: disabled || overReceiptQty > 0, primary: true },
        { label: 'All purchase orders', icon: 'list', to: 'purchase/orders' },
      ]}
    >
      {!canWrite && <Notice kind="info">Your account is read-only. Ask an administrator for the operator role to post receipts.</Notice>}
      <form onSubmit={save} noValidate>
        <FastTab title="Purchase order">
          <div className="form-grid">
            <Field label="Purchase order" error={shown.po_id}>
              <select value={form.po_id} onChange={set('po_id')} disabled={disabled}>
                <option value="">Select a purchase order…</option>
                {candidates.map((s) => (
                  <option key={s.po.po_id} value={s.po.po_id}>
                    {s.po.po_id} · {s.po.sku} @ {s.po.warehouse_id} · {s.isOpen ? `${s.remainingQty} open` : 'fully received'}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {summary && (
            <dl className="facts">
              <div><dt>Ordered</dt><dd>{summary.po.order_qty}</dd></div>
              <div><dt>Already received</dt><dd>{summary.receivedQty}</dd></div>
              <div><dt>Remaining</dt><dd><strong>{summary.remainingQty}</strong></dd></div>
              <div><dt>Item / warehouse</dt><dd className="mono">{summary.po.sku} @ {summary.po.warehouse_id}</dd></div>
            </dl>
          )}
        </FastTab>
        <FastTab title="Receipt">
          <div className="form-grid">
            <Field label="Received quantity" error={shown.received_qty}>
              <input type="number" min={1} step={1} inputMode="numeric" value={form.received_qty} onChange={set('received_qty')} disabled={disabled} />
            </Field>
            <Field label="Receipt date" error={shown.receipt_date}>
              <input type="date" max={today} value={form.receipt_date} onChange={set('receipt_date')} disabled={disabled} />
            </Field>
          </div>
          <p className="muted small">
            A receipt is an operational transaction. It does <strong>not</strong> change the inventory snapshot; on-hand inventory is recalculated by the
            reporting view.
          </p>
        </FastTab>
        <div className="form-footer">
          <button type="submit" className="primary" disabled={disabled || overReceiptQty > 0}>
            {submit.saving ? 'Posting…' : 'Post receipt'}
          </button>
        </div>
        {submit.saving && <Notice kind="loading">Saving to Supabase…</Notice>}
        {submit.result && (
          <Notice kind={submit.result.kind} onClose={() => submit.setResult(null)}>
            {submit.result.text}
          </Notice>
        )}
      </form>
    </Page>
  )
}
