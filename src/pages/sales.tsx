// Sales module task pages: all sales orders and new sales order.
import { useMemo, useState, type FormEvent } from 'react'
import { Field } from '../components/Field'
import { Notice } from '../components/Notice'
import { StatusBadge } from '../components/StatusBadge'
import { useErpData } from '../data/ErpData'
import { confirmSalesOrder, createSalesOrder } from '../data/salesOrders'
import { MAX_QTY } from '../lib/logic'
import { salesStage, stageTone, STAGES, type Stage } from '../lib/stage'
import type { SalesOrder } from '../lib/types'
import { DataGrid, FastTab, Page, StageFilter, type Column } from '../shell/Page'
import { useSubmit } from '../shell/useSubmit'

export function soColumns(): Column<SalesOrder>[] {
  return [
    { key: 'so', header: 'Sales order', render: (s) => <span className="mono link-text">{s.sales_order_id}</span>, sortValue: (s) => s.sales_order_id },
    { key: 'sku', header: 'Item', render: (s) => <span className="mono">{s.sku}</span>, sortValue: (s) => s.sku },
    { key: 'wh', header: 'Warehouse', render: (s) => <span className="mono">{s.warehouse_id}</span>, sortValue: (s) => s.warehouse_id },
    { key: 'qty', header: 'Ordered', render: (s) => s.order_qty, sortValue: (s) => s.order_qty, numeric: true },
    { key: 'ship', header: 'Shipped', render: (s) => s.shipped_qty, sortValue: (s) => s.shipped_qty, numeric: true },
    { key: 'open', header: 'Open qty', render: (s) => Math.max(0, (s.order_qty ?? 0) - (s.shipped_qty ?? 0)), sortValue: (s) => (s.order_qty ?? 0) - (s.shipped_qty ?? 0), numeric: true },
    { key: 'date', header: 'Order date', render: (s) => s.order_date, sortValue: (s) => s.order_date },
    { key: 'status', header: 'Status', render: (s) => s.status, sortValue: (s) => s.status },
    { key: 'stage', header: 'Order type', render: (s) => <StatusBadge tone={stageTone(salesStage(s))} text={salesStage(s)} />, sortValue: (s) => STAGES.indexOf(salesStage(s)) },
  ]
}

export function SalesOrdersPage({ route, canWrite }: { route: string; canWrite: boolean }) {
  const { data, loading, reload } = useErpData()
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage | 'All'>('All')
  const [selected, setSelected] = useState<string | null>(null)
  const submit = useSubmit()

  const all = data?.salesOrders ?? []
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, all.filter((x) => salesStage(x) === s).length])) as Record<Stage, number>, [all])
  const q = query.trim().toLowerCase()
  const rows = all.filter((s) => (stage === 'All' || salesStage(s) === stage) && (!q || [s.sales_order_id, s.sku, s.warehouse_id, s.status].join(' ').toLowerCase().includes(q)))
  const sel = all.find((s) => s.sales_order_id === selected) ?? null
  const product = data?.products.find((p) => p.sku === sel?.sku)

  const confirm = () =>
    sel &&
    submit.run(async () => {
      const so = await confirmSalesOrder(sel.sales_order_id)
      await reload()
      return `${so.sales_order_id} confirmed. Status is now ${so.status}.`
    })

  return (
    <Page
      route={route}
      title="All sales orders"
      actions={[
        { label: 'New', icon: 'plus', to: 'sales/new', disabled: !canWrite, primary: true },
        { label: 'Confirm', icon: 'check', onClick: confirm, disabled: !canWrite || !sel || salesStage(sel) !== 'Draft' || submit.saving, title: 'Confirm the selected draft' },
        { label: 'Refresh', icon: 'refresh', onClick: () => void reload(), disabled: loading },
      ]}
    >
      <div className="filter-bar">
        <input type="search" placeholder="Filter by order, item, warehouse…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter sales orders" />
        <StageFilter value={stage} onChange={setStage} counts={counts} />
      </div>
      {submit.result && (
        <Notice kind={submit.result.kind} onClose={() => submit.setResult(null)}>
          {submit.result.text}
        </Notice>
      )}
      <DataGrid columns={soColumns()} rows={rows} rowKey={(s) => s.sales_order_id} selectedKey={selected} onSelect={(s) => setSelected(s.sales_order_id)} empty="No sales orders match." />
      {sel && (
        <div className="details">
          <FastTab title={`Sales order ${sel.sales_order_id}`} summary={sel.status ?? undefined}>
            <dl className="facts">
              <div><dt>Item</dt><dd>{sel.sku} · {product?.product_name}</dd></div>
              <div><dt>Warehouse</dt><dd>{sel.warehouse_id}</dd></div>
              <div><dt>Ordered / shipped</dt><dd>{sel.order_qty} / {sel.shipped_qty}</dd></div>
              <div><dt>Order date</dt><dd>{sel.order_date}</dd></div>
              <div><dt>Order type</dt><dd>{salesStage(sel)}</dd></div>
            </dl>
          </FastTab>
        </div>
      )}
    </Page>
  )
}

const EMPTY_SO = { sku: '', warehouse_id: '', order_qty: '' }

export function NewSalesOrderPage({ route, canWrite }: { route: string; canWrite: boolean }) {
  const { data, reload } = useErpData()
  const [form, setForm] = useState(EMPTY_SO)
  const [touched, setTouched] = useState(false)
  const submit = useSubmit()
  const products = data?.products ?? []

  const qty = form.order_qty === '' ? NaN : Number(form.order_qty)
  const wh = form.warehouse_id.trim().toUpperCase()
  const errors: Record<string, string> = {}
  if (!form.sku) errors.sku = 'Choose an item.'
  if (!wh) errors.warehouse_id = 'Enter a warehouse.'
  else if (!/^[A-Z0-9-]{2,20}$/.test(wh)) errors.warehouse_id = 'Use letters, digits and dashes, e.g. KY-DC-01.'
  if (!Number.isFinite(qty)) errors.order_qty = 'Quantity is required.'
  else if (!Number.isInteger(qty) || qty <= 0) errors.order_qty = 'Quantity must be a whole number above zero.'
  else if (qty > MAX_QTY) errors.order_qty = 'Quantity looks too large.'
  const valid = Object.keys(errors).length === 0
  const shown = touched ? errors : {}

  // Show available stock for the chosen item and warehouse (from the reconciliation view).
  const stock = data?.reconciliation.find((r) => r.sku === form.sku && r.warehouse_id === wh)
  const shortBy = stock && Number.isFinite(qty) && qty > (stock.adjusted_available ?? 0) ? qty - (stock.adjusted_available ?? 0) : 0

  const save = (asDraft: boolean) => (e?: FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (!valid) return
    void submit.run(async () => {
      const so = await createSalesOrder({ sku: form.sku, warehouse_id: wh, order_qty: qty, as_draft: asDraft })
      setForm(EMPTY_SO)
      setTouched(false)
      await reload()
      return asDraft ? `Draft ${so.sales_order_id} saved (${so.order_qty} × ${so.sku}).` : `Sales order ${so.sales_order_id} created: ${so.order_qty} × ${so.sku} from ${so.warehouse_id}.`
    })
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const disabled = !canWrite || submit.saving

  return (
    <Page
      route={route}
      title="New sales order"
      subtitle="The order number, date and status are set by the database."
      actions={[
        { label: 'Confirm order', icon: 'check', onClick: save(false), disabled, primary: true },
        { label: 'Save as draft', icon: 'list', onClick: save(true), disabled },
        { label: 'All sales orders', icon: 'list', to: 'sales/orders' },
      ]}
    >
      {!canWrite && <Notice kind="info">Your account is read-only. Ask an administrator for the operator role to raise sales orders.</Notice>}
      <form onSubmit={save(false)} noValidate>
        <FastTab title="Sales order line">
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
            <Field label="Warehouse" error={shown.warehouse_id}>
              <input list="so-warehouses" value={form.warehouse_id} onChange={set('warehouse_id')} placeholder="e.g. KY-DC-01" disabled={disabled} />
              <datalist id="so-warehouses">
                {data?.warehouses.map((w) => <option key={w} value={w} />)}
              </datalist>
            </Field>
            <Field label="Quantity" error={shown.order_qty}>
              <input type="number" min={1} step={1} inputMode="numeric" value={form.order_qty} onChange={set('order_qty')} disabled={disabled} />
            </Field>
            <Field label="Available (adjusted)">
              <input value={stock ? String(stock.adjusted_available) : form.sku && wh ? 'No stock record' : ''} readOnly placeholder="—" />
            </Field>
          </div>
          {shortBy > 0 && <Notice kind="warning">This order is {shortBy} more than the adjusted available stock. It can still be saved, but it may become a backorder.</Notice>}
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
