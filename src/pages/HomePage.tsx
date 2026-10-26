// First screen after sign-in: welcome, module tiles, and what needs attention.
import { useErpData } from '../data/ErpData'
import { investigate } from '../lib/logic'
import { href } from '../lib/router'
import { purchaseStage, salesStage } from '../lib/stage'
import { Icon } from '../shell/Icon'
import { MODULES } from '../shell/modules'
import { Tile } from '../shell/Page'

export function HomePage({ userName }: { userName: string }) {
  const { data } = useErpData()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dateText = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const stats = data && {
    openPo: data.poSummaries.filter((s) => ['Open', 'Pending'].includes(purchaseStage(s))).length,
    overduePo: data.poSummaries.filter((s) => s.isOverdue).length,
    draftPo: data.poSummaries.filter((s) => purchaseStage(s) === 'Draft').length,
    openSo: data.salesOrders.filter((so) => ['Open', 'Pending'].includes(salesStage(so))).length,
    skus: data.reconciliation.length,
    discrepancies: data.reconciliation.filter(
      (row) =>
        investigate({ row, snapshot: data.snapshots.find((s) => s.snapshot_id === row.snapshot_id), receipts: data.receipts, salesOrders: data.salesOrders, poSummaries: data.poSummaries }).length > 0,
    ).length,
    products: data.products.length,
    suppliers: data.suppliers.length,
  }

  const counts: Record<string, { count?: number; label?: string; tone?: 'bad' | 'warn' }> = stats
    ? {
        purchase: { count: stats.openPo, label: `open · ${stats.overduePo} overdue`, tone: stats.overduePo > 0 ? 'bad' : undefined },
        sales: { count: stats.openSo, label: 'open sales orders' },
        inventory: { count: stats.skus, label: `stock positions · ${stats.discrepancies} to review`, tone: stats.discrepancies > 0 ? 'warn' : undefined },
        master: { count: stats.products, label: `products · ${stats.suppliers} suppliers` },
        reports: { count: 3, label: 'reports' },
      }
    : {}

  const overdue = data ? data.poSummaries.filter((s) => s.isOverdue).sort((a, b) => b.daysOverdue - a.daysOverdue) : []

  return (
    <div className="home">
      <section className="welcome">
        <div>
          <div className="welcome-date">{dateText}</div>
          <h1>Welcome, {userName}</h1>
          <p>
            {greeting}. Choose a module to get started{stats && stats.overduePo > 0 ? `. ${stats.overduePo} purchase order${stats.overduePo === 1 ? ' is' : 's are'} overdue` : ''}.
          </p>
        </div>
      </section>

      <h2 className="section-title">Modules</h2>
      <div className="tiles tiles-modules">
        {MODULES.map((m) => (
          <Tile key={m.id} to={m.id} title={m.title} description={m.description} icon={m.icon} count={counts[m.id]?.count} countLabel={counts[m.id]?.label} tone={counts[m.id]?.tone} />
        ))}
      </div>

      {data && (
        <div className="home-grid">
          <section className="panel">
            <h2>Needs attention</h2>
            {overdue.length === 0 && stats!.draftPo === 0 && stats!.discrepancies === 0 ? (
              <p className="muted">Nothing needs attention right now.</p>
            ) : (
              <ul className="attention">
                {overdue.map((s) => (
                  <li key={s.po.po_id}>
                    <Icon name="alert" size={16} className="tone-bad" />
                    <a href={href('purchase/orders')}>{s.po.po_id}</a> is {s.daysOverdue} day{s.daysOverdue === 1 ? '' : 's'} overdue: {s.remainingQty} × {s.po.sku} for{' '}
                    {s.po.warehouse_id}
                  </li>
                ))}
                {stats!.draftPo > 0 && (
                  <li>
                    <Icon name="list" size={16} />
                    <a href={href('purchase/orders')}>{stats!.draftPo} draft purchase order(s)</a> waiting to be confirmed
                  </li>
                )}
                {stats!.discrepancies > 0 && (
                  <li>
                    <Icon name="investigate" size={16} className="tone-warn" />
                    <a href={href('inventory/investigate')}>{stats!.discrepancies} stock position(s)</a> have discrepancies to review
                  </li>
                )}
              </ul>
            )}
          </section>
          <section className="panel">
            <h2>Quick links</h2>
            <ul className="quick-links">
              <li>
                <a href={href('purchase/new')}>New purchase order</a>
              </li>
              <li>
                <a href={href('purchase/receipt')}>Record a product receipt</a>
              </li>
              <li>
                <a href={href('sales/new')}>New sales order</a>
              </li>
              <li>
                <a href={href('reports/purchase')}>Purchase order report</a>
              </li>
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}
