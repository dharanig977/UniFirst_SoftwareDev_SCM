// Inventory module: on-hand by SKU/warehouse and discrepancy investigation.
import { useMemo, useState } from 'react'
import { Notice } from '../components/Notice'
import { StatusBadge } from '../components/StatusBadge'
import { useErpData, type ErpData } from '../data/ErpData'
import { investigate, recomputeReconciliation, type Finding } from '../lib/logic'
import type { ReconciliationRow } from '../lib/types'
import { DataGrid, FastTab, Page, type Column } from '../shell/Page'

export function findingsFor(data: ErpData, row: ReconciliationRow): Finding[] {
  return investigate({ row, snapshot: data.snapshots.find((s) => s.snapshot_id === row.snapshot_id), receipts: data.receipts, salesOrders: data.salesOrders, poSummaries: data.poSummaries })
}

export function viewMatches(data: ErpData, row: ReconciliationRow): boolean | null {
  const snap = data.snapshots.find((s) => s.snapshot_id === row.snapshot_id)
  if (!snap) return null
  const calc = recomputeReconciliation(snap, data.receipts)
  return calc.adjustedOnHand === row.adjusted_on_hand && calc.adjustedAvailable === row.adjusted_available
}

export function inventoryColumns(data: ErpData): Column<ReconciliationRow>[] {
  return [
    { key: 'sku', header: 'Item', render: (r) => <span className="mono">{r.sku}</span>, sortValue: (r) => r.sku },
    { key: 'name', header: 'Product name', render: (r) => r.product_name, sortValue: (r) => r.product_name },
    { key: 'wh', header: 'Warehouse', render: (r) => <span className="mono">{r.warehouse_id}</span>, sortValue: (r) => r.warehouse_id },
    { key: 'at', header: 'Snapshot at', render: (r) => r.snapshot_at?.replace('T', ' ').slice(0, 16), sortValue: (r) => r.snapshot_at },
    { key: 'snap', header: 'Snapshot qty', render: (r) => r.snapshot_qty, sortValue: (r) => r.snapshot_qty, numeric: true },
    { key: 'after', header: 'Receipts after', render: (r) => r.receipt_after_snapshot, sortValue: (r) => r.receipt_after_snapshot, numeric: true },
    { key: 'onhand', header: 'Adj. on hand', render: (r) => <strong>{r.adjusted_on_hand}</strong>, sortValue: (r) => r.adjusted_on_hand, numeric: true },
    { key: 'res', header: 'Reserved', render: (r) => r.reserved_qty, sortValue: (r) => r.reserved_qty, numeric: true },
    { key: 'avail', header: 'Adj. available', render: (r) => <strong>{r.adjusted_available}</strong>, sortValue: (r) => r.adjusted_available, numeric: true },
    {
      key: 'check',
      header: 'View check',
      render: (r) => {
        const m = viewMatches(data, r)
        return m === null ? '—' : m ? <StatusBadge tone="good" text="matches" /> : <StatusBadge tone="bad" text="differs" />
      },
    },
    {
      key: 'find',
      header: 'Findings',
      render: (r) => {
        const n = findingsFor(data, r).length
        return n ? <StatusBadge tone="warn" text={`${n} to review`} /> : <StatusBadge tone="good" text="none" />
      },
      sortValue: (r) => findingsFor(data, r).length,
    },
  ]
}

export function OnHandPage({ route }: { route: string }) {
  const { data, loading, reload } = useErpData()
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  if (!data) return null
  const q = filter.trim().toLowerCase()
  const rows = data.reconciliation.filter((r) => !q || `${r.sku} ${r.product_name} ${r.warehouse_id}`.toLowerCase().includes(q))
  const sel = data.reconciliation.find((r) => r.snapshot_id === selected) ?? null

  return (
    <Page
      route={route}
      title="On-hand inventory"
      subtitle={
        <>
          Source: <code>reporting.vw_inventory_reconciliation</code>. Adjusted on hand = snapshot + receipts after the snapshot day; adjusted available = on hand −
          reserved.
        </>
      }
      actions={[
        { label: 'Investigate', icon: 'investigate', to: 'inventory/investigate' },
        { label: 'Refresh', icon: 'refresh', onClick: () => void reload(), disabled: loading },
      ]}
    >
      <div className="filter-bar">
        <input type="search" placeholder="Filter by item, name, warehouse…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter inventory" />
      </div>
      <DataGrid columns={inventoryColumns(data)} rows={rows} rowKey={(r) => r.snapshot_id} selectedKey={selected} onSelect={(r) => setSelected(r.snapshot_id)} empty="No stock records." />
      {sel && <Investigation data={data} row={sel} />}
      <OperationalNote />
    </Page>
  )
}

export function InvestigationPage({ route }: { route: string }) {
  const { data } = useErpData()
  const withFindings = useMemo(() => (data ? data.reconciliation.map((r) => ({ row: r, n: findingsFor(data, r).length })) : []), [data])
  const [selected, setSelected] = useState<string | null>(null)
  if (!data) return null
  // Start on the position with the most findings.
  const firstWithFindings = [...withFindings].sort((a, b) => b.n - a.n)[0]?.row.snapshot_id ?? null
  const current = data.reconciliation.find((r) => r.snapshot_id === (selected ?? firstWithFindings)) ?? null

  return (
    <Page route={route} title="Discrepancy investigation" subtitle="Pick a stock position to see what doesn't add up and what to do about it.">
      <div className="split">
        <div className="split-list" role="listbox" aria-label="Stock positions">
          {withFindings.map(({ row, n }) => (
            <button key={row.snapshot_id} role="option" aria-selected={current?.snapshot_id === row.snapshot_id} className={current?.snapshot_id === row.snapshot_id ? 'active' : ''} onClick={() => setSelected(row.snapshot_id)}>
              <span className="mono">
                {row.sku} @ {row.warehouse_id}
              </span>
              {n > 0 ? <StatusBadge tone="warn" text={String(n)} /> : <StatusBadge tone="good" text="ok" />}
            </button>
          ))}
        </div>
        <div className="split-detail">{current ? <Investigation data={data} row={current} /> : <p className="muted">No stock records.</p>}</div>
      </div>
      <OperationalNote />
    </Page>
  )
}

function Investigation({ data, row }: { data: ErpData; row: ReconciliationRow }) {
  const findings = findingsFor(data, row)
  return (
    <div className="details">
      <FastTab title={`${row.sku} @ ${row.warehouse_id}: calculation`} summary={`available ${row.adjusted_available}`}>
        <div className="waterfall">
          <Step label="Snapshot qty" value={row.snapshot_qty} />
          <span className="op">+</span>
          <Step label="Receipts after snapshot" value={row.receipt_after_snapshot} />
          <span className="op">=</span>
          <Step label="Adjusted on hand" value={row.adjusted_on_hand} strong />
          <span className="op">−</span>
          <Step label="Reserved" value={row.reserved_qty} />
          <span className="op">=</span>
          <Step label="Adjusted available" value={row.adjusted_available} strong />
        </div>
        <p className="muted small">All values above are read from the database view for snapshot {row.snapshot_id}.</p>
      </FastTab>
      <FastTab title="Findings and recommendations" summary={`${findings.length} finding(s)`}>
        {findings.length === 0 ? (
          <Notice kind="success">No discrepancies found for this item and warehouse.</Notice>
        ) : (
          <ul className="findings">
            {findings.map((f, i) => (
              <li key={i} className={`finding finding-${f.severity}`}>
                <div className="finding-title">
                  <StatusBadge tone={f.severity === 'high' ? 'bad' : f.severity === 'medium' ? 'warn' : 'neutral'} text={f.severity} /> {f.title}
                </div>
                <div>{f.detail}</div>
                <div className="finding-rec">
                  <strong>Recommendation:</strong> {f.recommendation}
                </div>
              </li>
            ))}
          </ul>
        )}
      </FastTab>
    </div>
  )
}

function Step({ label, value, strong }: { label: string; value: number | null; strong?: boolean }) {
  return (
    <div className={`step${strong ? ' step-strong' : ''}`}>
      <strong>{value ?? '—'}</strong>
      <span>{label}</span>
    </div>
  )
}

function OperationalNote() {
  return (
    <FastTab title="Operational transactions vs reporting" defaultOpen={false}>
      <p>
        Purchase orders, product receipts and sales orders are <strong>operational transactions</strong>: they record what happened. The{' '}
        <strong>inventory snapshot</strong> is a point-in-time count and is never changed by this app. The reconciliation view <em>calculates</em> a current
        estimate by adding receipts recorded after the snapshot, so posting a receipt leaves the snapshot alone and raises the adjusted quantities.
      </p>
    </FastTab>
  )
}
