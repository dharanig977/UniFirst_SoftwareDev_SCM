// Reports module: purchase, sales and inventory reports with filters and CSV export.
import { useMemo, useState } from 'react'
import { useErpData } from '../data/ErpData'
import { purchaseStage, salesStage, STAGE_HELP, STAGES, type Stage } from '../lib/stage'
import { DataGrid, exportCsv, Page, StageFilter } from '../shell/Page'
import { findingsFor, inventoryColumns } from './inventory'
import { poColumns } from './purchase'
import { soColumns } from './sales'

function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <>
      <label className="inline-field">
        From <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} />
      </label>
      <label className="inline-field">
        To <input type="date" value={to} onChange={(e) => onTo(e.target.value)} />
      </label>
    </>
  )
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="inline-field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

function StageSummary({ counts, qty }: { counts: Record<Stage, number>; qty: Record<Stage, number> }) {
  return (
    <div className="kpis">
      {STAGES.map((s) => (
        <div key={s} className="kpi" title={STAGE_HELP[s]}>
          <span>{s}</span>
          <strong>{counts[s]}</strong>
          <span className="muted small">{qty[s].toLocaleString()} units outstanding</span>
        </div>
      ))}
    </div>
  )
}

export function PurchaseReportPage({ route }: { route: string }) {
  const { data } = useErpData()
  const [stage, setStage] = useState<Stage | 'All'>('All')
  const [supplier, setSupplier] = useState('')
  const [warehouse, setWarehouse] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)

  const base = useMemo(
    () =>
      (data?.poSummaries ?? []).filter(
        (s) =>
          (!supplier || s.po.supplier_id === supplier) &&
          (!warehouse || s.po.warehouse_id === warehouse) &&
          (!from || (s.po.order_date ?? '') >= from) &&
          (!to || (s.po.order_date ?? '') <= to) &&
          (!overdueOnly || s.isOverdue),
      ),
    [data, supplier, warehouse, from, to, overdueOnly],
  )
  const counts = Object.fromEntries(STAGES.map((s) => [s, base.filter((x) => purchaseStage(x) === s).length])) as Record<Stage, number>
  const qty = Object.fromEntries(STAGES.map((s) => [s, base.filter((x) => purchaseStage(x) === s).reduce((t, x) => t + Math.max(0, x.remainingQty), 0)])) as Record<Stage, number>
  const rows = base.filter((s) => stage === 'All' || purchaseStage(s) === stage)

  const doExport = () =>
    exportCsv(
      `purchase-orders-${stage.toLowerCase()}.csv`,
      ['PO', 'Vendor', 'Item', 'Warehouse', 'Ordered', 'Received', 'Remaining', 'Order date', 'Delivery date', 'Days late', 'Status', 'Order type'],
      rows.map((s) => [s.po.po_id, s.po.supplier_id, s.po.sku, s.po.warehouse_id, s.po.order_qty, s.receivedQty, s.remainingQty, s.po.order_date, s.po.expected_date, s.daysOverdue, s.po.status, purchaseStage(s)]),
    )

  return (
    <Page route={route} title="Purchase order report" subtitle={`As of ${data?.today ?? ''}`} actions={[{ label: 'Export to CSV', icon: 'download', onClick: doExport, disabled: rows.length === 0 }]}>
      <StageSummary counts={counts} qty={qty} />
      <div className="filter-bar">
        <StageFilter value={stage} onChange={setStage} counts={counts} />
      </div>
      <div className="filter-bar">
        <Select label="Vendor" value={supplier} options={(data?.suppliers ?? []).map((s) => s.supplier_id)} onChange={setSupplier} />
        <Select label="Warehouse" value={warehouse} options={data?.warehouses ?? []} onChange={setWarehouse} />
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <label className="inline-field">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
        </label>
      </div>
      <DataGrid columns={poColumns()} rows={rows} rowKey={(s) => s.po.po_id} empty="No purchase orders match these filters." />
      <p className="muted small">
        Order type: <strong>Draft</strong> = saved, not confirmed · <strong>Open</strong> = confirmed, nothing received · <strong>Pending</strong> = partly received ·{' '}
        <strong>Closed</strong> = fully received or closed. It's calculated from receipts, so a stale status text can't hide reality.
      </p>
    </Page>
  )
}

export function SalesReportPage({ route }: { route: string }) {
  const { data } = useErpData()
  const [stage, setStage] = useState<Stage | 'All'>('All')
  const [warehouse, setWarehouse] = useState('')
  const [sku, setSku] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const base = (data?.salesOrders ?? []).filter(
    (s) => (!warehouse || s.warehouse_id === warehouse) && (!sku || s.sku === sku) && (!from || (s.order_date ?? '') >= from) && (!to || (s.order_date ?? '') <= to),
  )
  const counts = Object.fromEntries(STAGES.map((s) => [s, base.filter((x) => salesStage(x) === s).length])) as Record<Stage, number>
  const qty = Object.fromEntries(
    STAGES.map((s) => [s, base.filter((x) => salesStage(x) === s).reduce((t, x) => t + Math.max(0, (x.order_qty ?? 0) - (x.shipped_qty ?? 0)), 0)]),
  ) as Record<Stage, number>
  const rows = base.filter((s) => stage === 'All' || salesStage(s) === stage)

  const doExport = () =>
    exportCsv(
      `sales-orders-${stage.toLowerCase()}.csv`,
      ['Sales order', 'Item', 'Warehouse', 'Ordered', 'Shipped', 'Open qty', 'Order date', 'Status', 'Order type'],
      rows.map((s) => [s.sales_order_id, s.sku, s.warehouse_id, s.order_qty, s.shipped_qty, Math.max(0, (s.order_qty ?? 0) - (s.shipped_qty ?? 0)), s.order_date, s.status, salesStage(s)]),
    )

  return (
    <Page route={route} title="Sales order report" subtitle={`As of ${data?.today ?? ''}`} actions={[{ label: 'Export to CSV', icon: 'download', onClick: doExport, disabled: rows.length === 0 }]}>
      <StageSummary counts={counts} qty={qty} />
      <div className="filter-bar">
        <StageFilter value={stage} onChange={setStage} counts={counts} />
      </div>
      <div className="filter-bar">
        <Select label="Item" value={sku} options={(data?.products ?? []).map((p) => p.sku)} onChange={setSku} />
        <Select label="Warehouse" value={warehouse} options={data?.warehouses ?? []} onChange={setWarehouse} />
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>
      <DataGrid columns={soColumns()} rows={rows} rowKey={(s) => s.sales_order_id} empty="No sales orders match these filters." />
      <p className="muted small">
        Order type: <strong>Draft</strong> = saved, not confirmed · <strong>Open</strong> = nothing shipped · <strong>Pending</strong> = partly shipped ·{' '}
        <strong>Closed</strong> = fully shipped or closed.
      </p>
    </Page>
  )
}

export function InventoryReportPage({ route }: { route: string }) {
  const { data } = useErpData()
  const [warehouse, setWarehouse] = useState('')
  const [onlyIssues, setOnlyIssues] = useState(false)
  if (!data) return null
  const rows = data.reconciliation.filter((r) => (!warehouse || r.warehouse_id === warehouse) && (!onlyIssues || findingsFor(data, r).length > 0))
  const totals = {
    onHand: rows.reduce((s, r) => s + (r.adjusted_on_hand ?? 0), 0),
    reserved: rows.reduce((s, r) => s + (r.reserved_qty ?? 0), 0),
    available: rows.reduce((s, r) => s + (r.adjusted_available ?? 0), 0),
    value: rows.reduce((s, r) => s + (r.adjusted_on_hand ?? 0) * (data.products.find((p) => p.sku === r.sku)?.unit_cost ?? 0), 0),
  }
  const doExport = () =>
    exportCsv(
      'inventory-report.csv',
      ['Item', 'Product', 'Warehouse', 'Snapshot at', 'Snapshot qty', 'Receipts after', 'Adj on hand', 'Reserved', 'Adj available', 'Findings'],
      rows.map((r) => [r.sku, r.product_name, r.warehouse_id, r.snapshot_at, r.snapshot_qty, r.receipt_after_snapshot, r.adjusted_on_hand, r.reserved_qty, r.adjusted_available, findingsFor(data, r).length]),
    )

  return (
    <Page route={route} title="Inventory report" subtitle="From reporting.vw_inventory_reconciliation" actions={[{ label: 'Export to CSV', icon: 'download', onClick: doExport, disabled: rows.length === 0 }]}>
      <div className="kpis">
        <div className="kpi"><span>Adjusted on hand</span><strong>{totals.onHand.toLocaleString()}</strong></div>
        <div className="kpi"><span>Reserved</span><strong>{totals.reserved.toLocaleString()}</strong></div>
        <div className="kpi"><span>Adjusted available</span><strong>{totals.available.toLocaleString()}</strong></div>
        <div className="kpi"><span>Stock value at cost</span><strong>{totals.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
      </div>
      <div className="filter-bar">
        <Select label="Warehouse" value={warehouse} options={data.warehouses} onChange={setWarehouse} />
        <label className="inline-field">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only positions with discrepancies
        </label>
      </div>
      <DataGrid columns={inventoryColumns(data)} rows={rows} rowKey={(r) => r.snapshot_id} empty="No stock positions match." />
    </Page>
  )
}
