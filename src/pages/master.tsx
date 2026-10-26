// Master Data Management: products, suppliers, warehouses.
import { useState, type FormEvent } from 'react'
import { Field } from '../components/Field'
import { Notice } from '../components/Notice'
import { useErpData } from '../data/ErpData'
import { createProduct, createSupplier } from '../data/masterData'
import type { Product, Supplier } from '../lib/types'
import { DataGrid, FastTab, Page } from '../shell/Page'
import { useSubmit } from '../shell/useSubmit'

export function ProductsPage({ route, canWrite }: { route: string; canWrite: boolean }) {
  const { data, loading, reload } = useErpData()
  const [q, setQ] = useState('')
  const rows = (data?.products ?? []).filter((p) => !q.trim() || `${p.sku} ${p.product_name} ${p.category}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <Page
      route={route}
      title="Products"
      actions={[
        { label: 'New', icon: 'plus', to: 'master/products/new', disabled: !canWrite, primary: true },
        { label: 'Refresh', icon: 'refresh', onClick: () => void reload(), disabled: loading },
      ]}
    >
      <div className="filter-bar">
        <input type="search" placeholder="Filter products…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter products" />
      </div>
      <DataGrid<Product>
        rows={rows}
        rowKey={(p) => p.sku}
        columns={[
          { key: 'sku', header: 'Item number', render: (p) => <span className="mono">{p.sku}</span>, sortValue: (p) => p.sku },
          { key: 'name', header: 'Product name', render: (p) => p.product_name, sortValue: (p) => p.product_name },
          { key: 'cat', header: 'Category', render: (p) => p.category, sortValue: (p) => p.category },
          { key: 'cost', header: 'Unit cost', render: (p) => (p.unit_cost != null ? p.unit_cost.toFixed(2) : '—'), sortValue: (p) => p.unit_cost, numeric: true },
          { key: 'pos', header: 'Purchase orders', render: (p) => data?.purchaseOrders.filter((x) => x.sku === p.sku).length ?? 0, numeric: true },
          { key: 'sos', header: 'Sales orders', render: (p) => data?.salesOrders.filter((x) => x.sku === p.sku).length ?? 0, numeric: true },
        ]}
      />
    </Page>
  )
}

export function SuppliersPage({ route, canWrite }: { route: string; canWrite: boolean }) {
  const { data, loading, reload } = useErpData()
  return (
    <Page
      route={route}
      title="Suppliers"
      actions={[
        { label: 'New', icon: 'plus', to: 'master/suppliers/new', disabled: !canWrite, primary: true },
        { label: 'Refresh', icon: 'refresh', onClick: () => void reload(), disabled: loading },
      ]}
    >
      <DataGrid<Supplier>
        rows={data?.suppliers ?? []}
        rowKey={(s) => s.supplier_id}
        columns={[
          { key: 'id', header: 'Vendor account', render: (s) => <span className="mono">{s.supplier_id}</span>, sortValue: (s) => s.supplier_id },
          { key: 'name', header: 'Name', render: (s) => s.supplier_name, sortValue: (s) => s.supplier_name },
          { key: 'lead', header: 'Lead time (days)', render: (s) => s.standard_lead_days ?? '—', sortValue: (s) => s.standard_lead_days, numeric: true },
          { key: 'open', header: 'Open POs', render: (s) => data?.poSummaries.filter((p) => p.po.supplier_id === s.supplier_id && p.isOpen).length ?? 0, numeric: true },
          { key: 'late', header: 'Overdue POs', render: (s) => data?.poSummaries.filter((p) => p.po.supplier_id === s.supplier_id && p.isOverdue).length ?? 0, numeric: true },
        ]}
      />
    </Page>
  )
}

export function WarehousesPage({ route }: { route: string }) {
  const { data } = useErpData()
  const rows = (data?.warehouses ?? []).map((w) => ({
    id: w,
    stock: data!.reconciliation.filter((r) => r.warehouse_id === w).reduce((s, r) => s + (r.adjusted_on_hand ?? 0), 0),
    skus: data!.reconciliation.filter((r) => r.warehouse_id === w).length,
    openPos: data!.poSummaries.filter((p) => p.po.warehouse_id === w && p.isOpen).length,
    sos: data!.salesOrders.filter((s) => s.warehouse_id === w).length,
  }))
  return (
    <Page route={route} title="Warehouses" subtitle="There is no warehouse table in the database; these are the sites used across all transactions.">
      <DataGrid
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { key: 'id', header: 'Warehouse', render: (r) => <span className="mono">{r.id}</span>, sortValue: (r) => r.id },
          { key: 'skus', header: 'Stock positions', render: (r) => r.skus, sortValue: (r) => r.skus, numeric: true },
          { key: 'stock', header: 'Adj. on hand', render: (r) => r.stock, sortValue: (r) => r.stock, numeric: true },
          { key: 'pos', header: 'Open POs', render: (r) => r.openPos, sortValue: (r) => r.openPos, numeric: true },
          { key: 'sos', header: 'Sales orders', render: (r) => r.sos, sortValue: (r) => r.sos, numeric: true },
        ]}
      />
    </Page>
  )
}

export function NewProductPage({ route, canWrite }: { route: string; canWrite: boolean }) {
  const { data, reload } = useErpData()
  const [form, setForm] = useState({ sku: '', product_name: '', category: '', unit_cost: '' })
  const [touched, setTouched] = useState(false)
  const submit = useSubmit()
  const sku = form.sku.trim().toUpperCase()
  const cost = form.unit_cost === '' ? null : Number(form.unit_cost)
  const errors: Record<string, string> = {}
  if (!sku) errors.sku = 'Item number is required.'
  else if (!/^[A-Z]{2,5}-[0-9]{3,6}$/.test(sku)) errors.sku = 'Use the existing pattern, e.g. UFS-1003.'
  else if (data?.products.some((p) => p.sku === sku)) errors.sku = `${sku} already exists.`
  if (!form.product_name.trim()) errors.product_name = 'Product name is required.'
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) errors.unit_cost = 'Unit cost must be zero or more.'
  const valid = Object.keys(errors).length === 0
  const shown = touched ? errors : {}
  const categories = [...new Set((data?.products ?? []).map((p) => p.category).filter(Boolean))] as string[]
  const disabled = !canWrite || submit.saving

  const save = (e?: FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (!valid) return
    void submit.run(async () => {
      const p = await createProduct({ sku, product_name: form.product_name.trim(), category: form.category.trim(), unit_cost: cost })
      setForm({ sku: '', product_name: '', category: '', unit_cost: '' })
      setTouched(false)
      await reload()
      return `Product ${p.sku} (${p.product_name}) created.`
    })
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  return (
    <Page route={route} title="New product" actions={[{ label: 'Save', icon: 'check', onClick: save, disabled, primary: true }, { label: 'Products', icon: 'list', to: 'master/products' }]}>
      {!canWrite && <Notice kind="info">Your account is read-only.</Notice>}
      <form onSubmit={save} noValidate>
        <FastTab title="General">
          <div className="form-grid">
            <Field label="Item number" error={shown.sku}>
              <input value={form.sku} onChange={set('sku')} placeholder="e.g. UFS-1003" disabled={disabled} />
            </Field>
            <Field label="Product name" error={shown.product_name}>
              <input value={form.product_name} onChange={set('product_name')} disabled={disabled} />
            </Field>
            <Field label="Category">
              <input list="categories" value={form.category} onChange={set('category')} disabled={disabled} />
              <datalist id="categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </Field>
            <Field label="Unit cost" error={shown.unit_cost}>
              <input type="number" min={0} step="0.01" value={form.unit_cost} onChange={set('unit_cost')} disabled={disabled} />
            </Field>
          </div>
        </FastTab>
        <div className="form-footer">
          <button type="submit" className="primary" disabled={disabled}>
            {submit.saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {submit.result && (
          <Notice kind={submit.result.kind} onClose={() => submit.setResult(null)}>
            {submit.result.text}
          </Notice>
        )}
      </form>
    </Page>
  )
}

export function NewSupplierPage({ route, canWrite }: { route: string; canWrite: boolean }) {
  const { data, reload } = useErpData()
  const [form, setForm] = useState({ supplier_name: '', standard_lead_days: '' })
  const [touched, setTouched] = useState(false)
  const submit = useSubmit()
  const lead = form.standard_lead_days === '' ? null : Number(form.standard_lead_days)
  const errors: Record<string, string> = {}
  if (!form.supplier_name.trim()) errors.supplier_name = 'Name is required.'
  else if (data?.suppliers.some((s) => s.supplier_name.toLowerCase() === form.supplier_name.trim().toLowerCase())) errors.supplier_name = 'A supplier with this name already exists.'
  if (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > 365)) errors.standard_lead_days = 'Lead time must be 0–365 whole days.'
  const valid = Object.keys(errors).length === 0
  const shown = touched ? errors : {}
  const disabled = !canWrite || submit.saving

  const save = (e?: FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (!valid) return
    void submit.run(async () => {
      const s = await createSupplier({ supplier_name: form.supplier_name.trim(), standard_lead_days: lead })
      setForm({ supplier_name: '', standard_lead_days: '' })
      setTouched(false)
      await reload()
      return `Supplier ${s.supplier_id} (${s.supplier_name}) created.`
    })
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  return (
    <Page route={route} title="New supplier" subtitle="The vendor account number is set by the database." actions={[{ label: 'Save', icon: 'check', onClick: save, disabled, primary: true }, { label: 'Suppliers', icon: 'list', to: 'master/suppliers' }]}>
      {!canWrite && <Notice kind="info">Your account is read-only.</Notice>}
      <form onSubmit={save} noValidate>
        <FastTab title="General">
          <div className="form-grid">
            <Field label="Name" error={shown.supplier_name}>
              <input value={form.supplier_name} onChange={set('supplier_name')} disabled={disabled} />
            </Field>
            <Field label="Standard lead time (days)" error={shown.standard_lead_days}>
              <input type="number" min={0} max={365} step={1} value={form.standard_lead_days} onChange={set('standard_lead_days')} disabled={disabled} />
            </Field>
          </div>
        </FastTab>
        <div className="form-footer">
          <button type="submit" className="primary" disabled={disabled}>
            {submit.saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {submit.result && (
          <Notice kind={submit.result.kind} onClose={() => submit.setResult(null)}>
            {submit.result.text}
          </Notice>
        )}
      </form>
    </Page>
  )
}
