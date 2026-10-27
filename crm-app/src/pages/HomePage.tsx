// First screen after sign-in: welcome, module tiles, this month's numbers and what needs attention.
import { useCrmData } from '../data/CrmData'
import { money, pct } from '../lib/format'
import { buildReport, monthOf, pctDiff, weightedAmount } from '../lib/plan'
import { href } from '../lib/router'
import { Icon } from '../shell/Icon'
import { MODULES } from '../shell/modules'
import { Tile } from '../shell/Page'

export function HomePage({ userName }: { userName: string }) {
  const { data } = useCrmData()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dateText = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  if (!data) return null

  const thisMonth = monthOf(new Date().toISOString().slice(0, 10))
  const version = data.budgetVersions.find((v) => v.version_status === 'Approved')?.budget_version ?? data.budgetVersions[0]?.budget_version ?? ''
  const mtd = buildReport(data, { version, from: thisMonth, to: thisMonth }, 'month').total
  const openOpps = data.opportunities.filter((o) => !o.stage.startsWith('Closed'))
  const pipeline = openOpps.reduce((s, o) => s + o.amount, 0)
  const weighted = openOpps.reduce((s, o) => s + weightedAmount(o), 0)
  const today = new Date().toISOString().slice(0, 10)
  const overdueActs = data.activities.filter((a) => !a.is_done && a.due_date && a.due_date < today)
  const closingSoon = openOpps.filter((o) => o.close_date < new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10))

  const counts: Record<string, { count?: number; label?: string; tone?: 'bad' | 'warn' }> = {
    customers: { count: data.accounts.length, label: `accounts · ${data.contacts.length} contacts` },
    sales: { count: openOpps.length, label: `open · ${money(pipeline)}` },
    planning: { count: data.budgetVersions.length, label: 'budget versions' },
    orders: { count: data.orders.length, label: 'ERP orders linked' },
    reports: { count: 2, label: 'reports' },
  }

  return (
    <div className="home">
      <section className="welcome">
        <div>
          <div className="welcome-date">{dateText}</div>
          <h1>Welcome, {userName}</h1>
          <p>{greeting}. Choose a module to get started.</p>
        </div>
      </section>

      <h2 className="section-title">This month ({version || 'no budget'})</h2>
      <div className="kpis">
        <div className="kpi">
          <span>Customer demand</span>
          <strong>{money(mtd.demandAmount)}</strong>
        </div>
        <div className="kpi">
          <span>Budget</span>
          <strong>{money(mtd.budgetAmount)}</strong>
        </div>
        <div className="kpi">
          <span>Actual (linked ERP orders)</span>
          <strong>{money(mtd.actualAmount)}</strong>
          <span className="muted small">{pct(pctDiff(mtd.actualAmount, mtd.budgetAmount))} vs budget</span>
        </div>
        <div className="kpi">
          <span>Weighted pipeline</span>
          <strong>{money(weighted)}</strong>
          <span className="muted small">{money(pipeline)} open</span>
        </div>
      </div>

      <h2 className="section-title">Modules</h2>
      <div className="tiles tiles-modules">
        {MODULES.map((m) => (
          <Tile key={m.id} to={m.id} title={m.title} description={m.description} icon={m.icon} count={counts[m.id]?.count} countLabel={counts[m.id]?.label} tone={counts[m.id]?.tone} />
        ))}
      </div>

      <div className="home-grid">
        <section className="panel">
          <h2>Needs attention</h2>
          {overdueActs.length === 0 && closingSoon.length === 0 && data.orders.length > 0 ? (
            <p className="muted">Nothing needs attention right now.</p>
          ) : (
            <ul className="attention">
              {data.orders.length === 0 && (
                <li>
                  <Icon name="link" size={16} className="tone-warn" />
                  No ERP orders are linked yet, so Actual shows 0. <a href={href('orders/link')}>Link ERP sales orders</a>
                </li>
              )}
              {overdueActs.length > 0 && (
                <li>
                  <Icon name="alert" size={16} className="tone-bad" />
                  <a href={href('customers/activities')}>{overdueActs.length} activit{overdueActs.length === 1 ? 'y is' : 'ies are'} overdue</a>
                </li>
              )}
              {closingSoon.length > 0 && (
                <li>
                  <Icon name="opportunity" size={16} />
                  <a href={href('sales/pipeline')}>{closingSoon.length} opportunit{closingSoon.length === 1 ? 'y closes' : 'ies close'} within 30 days</a>
                </li>
              )}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2>Quick links</h2>
          <ul className="quick-links">
            <li>
              <a href={href('customers/new')}>New account</a>
            </li>
            <li>
              <a href={href('planning/demand')}>Enter customer demand</a>
            </li>
            <li>
              <a href={href('orders/link')}>Link ERP sales orders</a>
            </li>
            <li>
              <a href={href('reports/dab')}>Demand vs Actual vs Budget report</a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  )
}
