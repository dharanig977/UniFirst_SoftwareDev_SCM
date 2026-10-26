// Screen B: inventory by SKU/warehouse from the reconciliation view,
// open/overdue POs, and a discrepancy investigation panel.
import { useMemo, useState } from 'react'
import { Notice } from '../components/Notice'
import { StatusBadge } from '../components/StatusBadge'
import { listGoodsReceipts } from '../data/goodsReceipts'
import { listPurchaseOrders } from '../data/purchaseOrders'
import { listInventoryReconciliation, listInventorySnapshots, listSalesOrders } from '../data/reporting'
import { investigate, recomputeReconciliation, summarizePurchaseOrders, todayISO, type Finding } from '../lib/logic'
import type { ReconciliationRow } from '../lib/types'
import { useLoader } from '../lib/useLoader'

export function InventoryScreen({ refreshKey }: { refreshKey: number }) {
  const today = todayISO()
  const { data, loading, error, reload } = useLoader(
    () => Promise.all([listInventoryReconciliation(), listInventorySnapshots(), listGoodsReceipts(), listSalesOrders(), listPurchaseOrders()]),
    [refreshKey],
  )
  const [recon, snapshots, receipts, salesOrders, pos] = data ?? [[], [], [], [], []]
  const poSummaries = useMemo(() => summarizePurchaseOrders(pos, receipts, today), [pos, receipts, today])

  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Findings for every row, so the table can show a count per row.
  const findingsById = useMemo(() => {
    const m = new Map<string, Finding[]>()
    for (const row of recon) {
      m.set(row.snapshot_id, investigate({ row, snapshot: snapshots.find((s) => s.snapshot_id === row.snapshot_id), receipts, salesOrders, poSummaries }))
    }
    return m
  }, [recon, snapshots, receipts, salesOrders, poSummaries])

  const q = filter.trim().toLowerCase()
  const rows = recon.filter((r) => !q || `${r.sku} ${r.product_name} ${r.warehouse_id}`.toLowerCase().includes(q))
  const selected = recon.find((r) => r.snapshot_id === selectedId) ?? null
  const openPos = poSummaries.filter((s) => s.isOpen).sort((a, b) => b.daysOverdue - a.daysOverdue)

  const totals = {
    onHand: recon.reduce((s, r) => s + (r.adjusted_on_hand ?? 0), 0),
    available: recon.reduce((s, r) => s + (r.adjusted_available ?? 0), 0),
    openPos: openPos.length,
    overdue: openPos.filter((s) => s.isOverdue).length,
  }

  return (
    <div className="stack">
      {loading && <Notice kind="loading">Loading inventory from Supabase…</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      {!loading && !error && (
        <>
          <div className="kpis">
            <Kpi label="Adjusted on hand" value={totals.onHand} />
            <Kpi label="Adjusted available" value={totals.available} />
            <Kpi label="Open POs" value={totals.openPos} />
            <Kpi label="Overdue POs" value={totals.overdue} tone={totals.overdue > 0 ? 'bad' : undefined} />
          </div>

          <section className="card">
            <header className="card-header">
              <h2>Inventory by SKU and warehouse</h2>
              <div className="toolbar">
                <input type="search" placeholder="Filter SKU, product, warehouse…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter inventory" />
                <button type="button" onClick={reload}>
                  Refresh
                </button>
              </div>
            </header>
            <p className="muted small">
              Source: <code>reporting.vw_inventory_reconciliation</code>. Adjusted on-hand = snapshot + receipts after the snapshot day. Adjusted available = adjusted
              on-hand − reserved. "View check" recalculates each row in the browser from the raw tables and compares.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Warehouse</th>
                    <th>Snapshot at</th>
                    <th className="num">Snapshot qty</th>
                    <th className="num">Receipts after</th>
                    <th className="num">Adj. on hand</th>
                    <th className="num">Reserved</th>
                    <th className="num">Adj. available</th>
                    <th>View check</th>
                    <th>Findings</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={11} className="empty">
                        No inventory rows.
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => {
                    const snap = snapshots.find((s) => s.snapshot_id === r.snapshot_id)
                    const calc = snap ? recomputeReconciliation(snap, receipts) : null
                    const matches = calc && calc.adjustedOnHand === r.adjusted_on_hand && calc.adjustedAvailable === r.adjusted_available
                    const n = findingsById.get(r.snapshot_id)?.length ?? 0
                    return (
                      <tr key={r.snapshot_id} className={`clickable${selectedId === r.snapshot_id ? ' selected' : ''}`} onClick={() => setSelectedId(r.snapshot_id)}>
                        <td className="mono">{r.sku}</td>
                        <td>{r.product_name}</td>
                        <td className="mono">{r.warehouse_id}</td>
                        <td>{r.snapshot_at?.replace('T', ' ').slice(0, 16)}</td>
                        <td className="num">{r.snapshot_qty}</td>
                        <td className="num">{r.receipt_after_snapshot}</td>
                        <td className="num strong">{r.adjusted_on_hand}</td>
                        <td className="num">{r.reserved_qty}</td>
                        <td className="num strong">{r.adjusted_available}</td>
                        <td>{calc ? matches ? <StatusBadge tone="good" text="matches" /> : <StatusBadge tone="bad" text="differs" /> : '—'}</td>
                        <td>{n > 0 ? <StatusBadge tone="warn" text={`${n} to review`} /> : <StatusBadge tone="good" text="none" />}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <InvestigationPanel row={selected} findings={selected ? findingsById.get(selected.snapshot_id) ?? [] : []} />

          <section className="card">
            <header className="card-header">
              <h2>Open and overdue purchase orders</h2>
              <span className="muted small">as of {today}</span>
            </header>
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
                    <th className="num">Outstanding</th>
                    <th>Expected</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {openPos.length === 0 && (
                    <tr>
                      <td colSpan={9} className="empty">
                        No open purchase orders.
                      </td>
                    </tr>
                  )}
                  {openPos.map((s) => (
                    <tr key={s.po.po_id}>
                      <td className="mono">{s.po.po_id}</td>
                      <td>{s.po.supplier_id}</td>
                      <td className="mono">{s.po.sku}</td>
                      <td className="mono">{s.po.warehouse_id}</td>
                      <td className="num">{s.po.order_qty}</td>
                      <td className="num">{s.receivedQty}</td>
                      <td className="num strong">{s.remainingQty}</td>
                      <td>{s.po.expected_date}</td>
                      <td>{s.isOverdue ? <StatusBadge tone="bad" text={`Overdue ${s.daysOverdue}d`} /> : <StatusBadge tone="neutral" text="On time" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card explainer">
            <h2>Operational transactions vs reporting</h2>
            <p>
              <strong>Goods receipts</strong> and <strong>purchase orders</strong> are operational transactions: they record what happened. The{' '}
              <strong>inventory snapshot</strong> is a point-in-time count and is never changed by this app. The reconciliation view{' '}
              <em>calculates</em> a current estimate by adding receipts recorded after the snapshot. So when you record a receipt on the Operations
              screen, the snapshot quantity stays the same and the adjusted quantities here go up.
            </p>
          </section>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'bad' }) {
  return (
    <div className={`kpi${tone ? ` kpi-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  )
}

function InvestigationPanel({ row, findings }: { row: ReconciliationRow | null; findings: Finding[] }) {
  if (!row) {
    return (
      <section className="card">
        <h2>Discrepancy investigation</h2>
        <p className="muted">Select an inventory row above to investigate it.</p>
      </section>
    )
  }
  return (
    <section className="card">
      <header className="card-header">
        <h2>
          Discrepancy investigation: <span className="mono">{row.sku}</span> @ <span className="mono">{row.warehouse_id}</span>
        </h2>
      </header>
      <div className="waterfall">
        <Step label="Snapshot qty" value={row.snapshot_qty} />
        <Op>+</Op>
        <Step label="Receipts after snapshot" value={row.receipt_after_snapshot} />
        <Op>=</Op>
        <Step label="Adjusted on hand" value={row.adjusted_on_hand} strong />
        <Op>−</Op>
        <Step label="Reserved" value={row.reserved_qty} />
        <Op>=</Op>
        <Step label="Adjusted available" value={row.adjusted_available} strong />
      </div>
      <p className="muted small">All values above are read from the database view for snapshot {row.snapshot_id}.</p>
      {findings.length === 0 ? (
        <Notice kind="success">No discrepancies found for this SKU and warehouse.</Notice>
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
    </section>
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

function Op({ children }: { children: string }) {
  return <div className="op">{children}</div>
}
