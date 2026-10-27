// Reports: Demand vs Actual vs Budget (the report Power BI will also show),
// and the pipeline report. Both export to CSV.
import { useState } from 'react'
import { Notice } from '../components/Notice'
import { useCrmData } from '../data/CrmData'
import { money, pct, qty } from '../lib/format'
import { buildReport, forecastAccuracy, monthLabel, monthOf, pctDiff, weightedAmount, type GroupBy, type Measures, type ReportRow } from '../lib/plan'
import { STAGES, WAREHOUSES } from '../lib/types'
import { DataGrid, exportCsv, Page, type Column } from '../shell/Page'

const tone = (v: number | null) => (v === null ? undefined : v >= 0 ? 'var-good' : 'var-bad')

export function DabReportPage({ route }: { route: string }) {
  const { data, accountById } = useCrmData()
  const versions = data!.budgetVersions
  const [version, setVersion] = useState(versions.find((v) => v.version_status === 'Approved')?.budget_version ?? versions[0]?.budget_version ?? '')
  const fy = versions.find((v) => v.budget_version === version)?.fiscal_year ?? new Date().getFullYear()
  const [from, setFrom] = useState(`${fy - 1}-07`)
  const [to, setTo] = useState(monthOf(new Date().toISOString().slice(0, 10)).slice(0, 7))
  const [groupBy, setGroupBy] = useState<GroupBy>('month')
  const [unit, setUnit] = useState<'amount' | 'qty'>('amount')
  const [warehouse, setWarehouse] = useState('')
  const [accountId, setAccountId] = useState('')
  const [category, setCategory] = useState('')
  const categories = [...new Set(data!.priceList.map((p) => p.category).filter(Boolean))] as string[]

  const { rows, total } = buildReport(data!, { version, from: `${from}-01`, to: `${to}-01`, warehouse: warehouse || undefined, accountId: accountId || undefined, category: category || undefined }, groupBy)
  const pick = (m: Measures) => (unit === 'amount' ? { d: m.demandAmount, b: m.budgetAmount, a: m.actualAmount } : { d: m.demandQty, b: m.budgetQty, a: m.actualQty })
  const fmt = unit === 'amount' ? money : qty
  const label = (k: string) => (groupBy === 'month' ? monthLabel(k) : groupBy === 'account' ? (accountById.get(k)?.account_name ?? k) : k)
  const t = pick(total)
  const max = Math.max(1, ...rows.map((r) => Math.max(...Object.values(pick(r)))))

  const columns: Column<ReportRow>[] = [
    { key: 'k', header: groupBy === 'month' ? 'Month' : groupBy === 'account' ? 'Customer' : groupBy === 'sku' ? 'SKU' : 'Warehouse', render: (r) => label(r.key), sortValue: (r) => (groupBy === 'account' ? label(r.key) : r.key) },
    { key: 'd', header: 'Demand', render: (r) => fmt(pick(r).d), numeric: true, sortValue: (r) => pick(r).d },
    { key: 'b', header: 'Budget', render: (r) => fmt(pick(r).b), numeric: true, sortValue: (r) => pick(r).b },
    { key: 'a', header: 'Actual', render: (r) => fmt(pick(r).a), numeric: true, sortValue: (r) => pick(r).a },
    { key: 'ab', header: 'Actual vs budget', render: (r) => { const v = pctDiff(pick(r).a, pick(r).b); return <span className={tone(v)}>{pct(v)}</span> }, numeric: true, sortValue: (r) => pctDiff(pick(r).a, pick(r).b) },
    { key: 'ad', header: 'Actual vs demand', render: (r) => { const v = pctDiff(pick(r).a, pick(r).d); return <span className={tone(v)}>{pct(v)}</span> }, numeric: true, sortValue: (r) => pctDiff(pick(r).a, pick(r).d) },
    { key: 'db', header: 'Demand vs budget', render: (r) => pct(pctDiff(pick(r).d, pick(r).b)), numeric: true, sortValue: (r) => pctDiff(pick(r).d, pick(r).b) },
    { key: 'acc', header: 'Forecast accuracy', render: (r) => { const v = forecastAccuracy(r.actualQty, r.demandQty); return v === null ? '—' : `${v.toFixed(0)}%` }, numeric: true, sortValue: (r) => forecastAccuracy(r.actualQty, r.demandQty) },
  ]

  const csv = () =>
    exportCsv(
      `demand-actual-budget-${groupBy}.csv`,
      ['group', 'demand_qty', 'demand_amount', 'budget_qty', 'budget_amount', 'actual_qty', 'actual_amount'],
      rows.map((r) => [label(r.key), r.demandQty, +r.demandAmount.toFixed(2), r.budgetQty, +r.budgetAmount.toFixed(2), r.actualQty, +r.actualAmount.toFixed(2)]),
    )

  return (
    <Page route={route} title="Demand vs Actual vs Budget" subtitle="Demand = customer forecasts. Budget = the selected version. Actual = ERP sales orders linked to customers, at their net price." actions={[{ label: 'Export CSV', icon: 'download', onClick: csv }]}>
      <div className="filter-bar">
        <label className="inline-field">
          Budget
          <select value={version} onChange={(e) => setVersion(e.target.value)}>
            {versions.map((v) => (
              <option key={v.budget_version}>{v.budget_version}</option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          From <input type="month" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="inline-field">
          To <input type="month" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <label className="inline-field">
          By
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            <option value="month">Month</option>
            <option value="account">Customer</option>
            <option value="sku">SKU</option>
            <option value="warehouse">Warehouse</option>
          </select>
        </label>
        <label className="inline-field">
          Show
          <select value={unit} onChange={(e) => setUnit(e.target.value as 'amount' | 'qty')}>
            <option value="amount">Amount (USD)</option>
            <option value="qty">Units</option>
          </select>
        </label>
      </div>
      <div className="filter-bar">
        <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} aria-label="Warehouse">
          <option value="">All warehouses</option>
          {WAREHOUSES.map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Customer">
          <option value="">All customers</option>
          {data!.accounts.map((a) => (
            <option key={a.account_id} value={a.account_id}>
              {a.account_name}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      {data!.orders.length === 0 && (
        <Notice kind="warning">
          No ERP orders are linked to customers yet, so Actual is 0. Go to <a href="#/orders/link">Link ERP sales orders</a> and click Auto-link all.
        </Notice>
      )}
      <div className="kpis">
        <div className="kpi">
          <span>Demand</span>
          <strong>{fmt(t.d)}</strong>
          <span className="muted small">{pct(pctDiff(t.d, t.b))} vs budget</span>
        </div>
        <div className="kpi">
          <span>Budget</span>
          <strong>{fmt(t.b)}</strong>
        </div>
        <div className="kpi">
          <span>Actual</span>
          <strong>{fmt(t.a)}</strong>
          <span className={`small ${tone(pctDiff(t.a, t.b)) ?? 'muted'}`}>{pct(pctDiff(t.a, t.b))} vs budget</span>
        </div>
        <div className="kpi">
          <span>Forecast accuracy (units)</span>
          <strong>{(() => { const v = forecastAccuracy(total.actualQty, total.demandQty); return v === null ? '—' : `${v.toFixed(0)}%` })()}</strong>
          <span className="muted small">1 − |actual − demand| ÷ actual</span>
        </div>
      </div>
      {groupBy === 'month' && rows.length > 0 && (
        <section className="panel">
          <div className="legend">
            <span><i style={{ background: 'var(--border-strong)' }} />Budget</span>
            <span><i style={{ background: 'var(--accent)' }} />Actual</span>
            <span><i style={{ background: 'var(--tile-4)', width: 3 }} />Demand</span>
          </div>
          <div className="bars">
            {rows.map((r) => {
              const v = pick(r)
              return (
                <div key={r.key} className="bar-row" title={`Demand ${fmt(v.d)} · Budget ${fmt(v.b)} · Actual ${fmt(v.a)}`}>
                  <span>{monthLabel(r.key)}</span>
                  <div className="bar-track">
                    <div className="bar bar-budget" style={{ width: `${(v.b / max) * 100}%` }} />
                    <div className="bar bar-actual" style={{ width: `${(v.a / max) * 100}%` }} />
                    <div className="bar-demand" style={{ left: `${(v.d / max) * 100}%` }} />
                  </div>
                  <span className="num small">{fmt(v.a)}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}
      <DataGrid<ReportRow> rows={rows} rowKey={(r) => r.key} columns={columns} empty="No data for these filters." />
    </Page>
  )
}

export function PipelineReportPage({ route }: { route: string }) {
  const { data } = useCrmData()
  const owners = [...new Set(data!.opportunities.map((o) => o.owner ?? '(none)'))].sort()
  const rows = owners.map((owner) => {
    const mine = data!.opportunities.filter((o) => (o.owner ?? '(none)') === owner)
    const byStage = Object.fromEntries(STAGES.map((s) => [s, mine.filter((o) => o.stage === s).reduce((t, o) => t + o.amount, 0)]))
    const won = byStage['Closed Won']
    const lost = byStage['Closed Lost']
    return { owner, byStage, weighted: mine.reduce((t, o) => t + weightedAmount(o), 0), winRate: won + lost ? (won / (won + lost)) * 100 : null }
  })
  type Row = (typeof rows)[number]
  const csv = () => exportCsv('pipeline.csv', ['owner', ...STAGES, 'weighted'], rows.map((r) => [r.owner, ...STAGES.map((s) => r.byStage[s]), +r.weighted.toFixed(2)]))
  return (
    <Page route={route} title="Pipeline report" subtitle="Opportunity amount by owner and stage. Weighted = amount × probability, open opportunities only." actions={[{ label: 'Export CSV', icon: 'download', onClick: csv }]}>
      <DataGrid<Row>
        rows={rows}
        rowKey={(r) => r.owner}
        columns={[
          { key: 'o', header: 'Owner', render: (r) => r.owner, sortValue: (r) => r.owner },
          ...STAGES.map((s) => ({ key: s, header: s, render: (r: Row) => money(r.byStage[s]), numeric: true, sortValue: (r: Row) => r.byStage[s] })),
          { key: 'w', header: 'Weighted', render: (r) => money(r.weighted), numeric: true, sortValue: (r) => r.weighted },
          { key: 'win', header: 'Win rate', render: (r) => (r.winRate === null ? '—' : `${r.winRate.toFixed(0)}%`), numeric: true, sortValue: (r) => r.winRate },
        ]}
      />
    </Page>
  )
}
