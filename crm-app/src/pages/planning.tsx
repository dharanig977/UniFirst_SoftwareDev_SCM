// Demand & Budget: monthly planning grids (account x SKU x month) and the price list.
import { useMemo, useState } from 'react'
import { Field } from '../components/Field'
import { Notice } from '../components/Notice'
import { StatusBadge } from '../components/StatusBadge'
import { useCrmData } from '../data/CrmData'
import { api, type Cell } from '../lib/api'
import { money, money2, qty } from '../lib/format'
import { monthLabel, monthOf, monthRange, netPrice } from '../lib/plan'
import type { PriceItem } from '../lib/types'
import { DataGrid, FastTab, Page } from '../shell/Page'
import { useSubmit } from '../shell/useSubmit'

type P = { route: string; canWrite: boolean }

/** Fiscal year starts in July: FY2027 = Jul 2026 - Jun 2027. */
const fyStart = (fy: number) => `${fy - 1}-07-01`
const currentFy = () => {
  const d = new Date()
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()
}

export function DemandPage({ route, canWrite }: P) {
  const { data } = useCrmData()
  const values = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of data!.forecasts) m.set(`${f.account_id}|${f.sku}|${f.forecast_month}`, f.forecast_qty)
    return m
  }, [data])
  return (
    <Page route={route} title="Demand forecast" subtitle="What each customer expects to buy, in units per month. Blank a cell to remove it.">
      <PlanGrid canWrite={canWrite} values={values} save={(cells) => api.saveForecast(cells)} kind="demand" />
    </Page>
  )
}

export function BudgetPage({ route, canWrite }: P) {
  const { data, reload } = useCrmData()
  const versions = data!.budgetVersions
  const [version, setVersion] = useState(versions.find((v) => v.version_status === 'Draft')?.budget_version ?? versions[0]?.budget_version ?? '')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const v = versions.find((x) => x.budget_version === version)
  const approve = useSubmit()
  const values = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of data!.budgets) if (b.budget_version === version) m.set(`${b.account_id}|${b.sku}|${b.budget_month}`, b.budget_qty)
    return m
  }, [data, version])
  const locked = v?.version_status !== 'Draft'

  return (
    <Page
      route={route}
      title="Sales budget"
      subtitle="Planned units per customer, SKU and month. Amounts use the customer's net price. Approved versions are locked."
      actions={[
        { label: 'New version', icon: 'plus', onClick: () => setCreating(!creating), disabled: !canWrite, primary: true },
        {
          label: 'Approve',
          icon: 'check',
          disabled: !canWrite || locked || approve.saving,
          title: 'Lock this version as the approved budget',
          onClick: () => {
            if (!window.confirm(`Approve "${version}"? It can't be edited afterwards.`)) return
            void approve.run(async () => {
              await api.approveBudgetVersion(version)
              await reload()
              return `"${version}" approved.`
            })
          },
        },
      ]}
    >
      {approve.result && (
        <Notice kind={approve.result.kind} onClose={() => approve.setResult(null)}>
          {approve.result.text}
        </Notice>
      )}
      {created && (
        <Notice kind="success" onClose={() => setCreated(null)}>
          {created}
        </Notice>
      )}
      {creating && (
        <NewVersionForm
          copyFrom={version}
          onDone={(name, msg) => {
            setCreating(false)
            setVersion(name)
            setCreated(msg)
          }}
        />
      )}
      <div className="filter-bar">
        <label className="inline-field">
          Version
          <select value={version} onChange={(e) => setVersion(e.target.value)}>
            {versions.map((x) => (
              <option key={x.budget_version} value={x.budget_version}>
                {x.budget_version} ({x.version_status})
              </option>
            ))}
          </select>
        </label>
        {v && <StatusBadge text={v.version_status} tone={v.version_status === 'Approved' ? 'good' : v.version_status === 'Draft' ? 'warn' : 'neutral'} />}
      </div>
      {!v ? (
        <Notice kind="info">No budget versions yet. Create one with New version.</Notice>
      ) : (
        <PlanGrid key={version} canWrite={canWrite && !locked} values={values} save={(cells) => api.saveBudget(version, cells)} kind="budget" fy={v.fiscal_year} lockedNote={locked ? `"${version}" is ${v.version_status}. Use New version to copy it into an editable draft.` : undefined} />
      )}
    </Page>
  )
}

function NewVersionForm({ copyFrom, onDone }: { copyFrom: string; onDone: (name: string, message: string) => void }) {
  const { reload } = useCrmData()
  const [name, setName] = useState('')
  const [fy, setFy] = useState(String(currentFy()))
  const [copy, setCopy] = useState(true)
  const s = useSubmit()
  return (
    <FastTab title="New budget version">
      <div className="form-grid">
        <Field label="Version name *" hint="e.g. FY2027 Reforecast Q2">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Fiscal year *" hint="FY runs July to June">
          <input type="number" value={fy} onChange={(e) => setFy(e.target.value)} />
        </Field>
        <Field label={`Copy all lines from "${copyFrom}"`}>
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} disabled={!copyFrom} />
        </Field>
      </div>
      <div className="form-footer">
        <button
          className="primary"
          disabled={s.saving || !name.trim()}
          onClick={() =>
            void s.run(async () => {
              const r = await api.createBudgetVersion({ budget_version: name.trim(), fiscal_year: Number(fy), copy_from: copy ? copyFrom : undefined })
              await reload()
              const msg = `Created draft "${r.created}" with ${r.copied} lines copied. Edit it below, then Approve.`
              onDone(r.created, msg)
              return msg
            })
          }
        >
          {s.saving ? 'Creating…' : 'Create draft'}
        </button>
      </div>
      {s.result && <Notice kind={s.result.kind}>{s.result.text}</Notice>}
    </FastTab>
  )
}

/**
 * Editable grid for one account: one row per SKU, one column per month.
 * Under each SKU, a read-only row shows the actual units from linked ERP orders.
 */
function PlanGrid({
  canWrite,
  values,
  save,
  kind,
  fy,
  lockedNote,
}: {
  canWrite: boolean
  values: Map<string, number>
  save: (cells: Cell[]) => Promise<{ saved: number; removed: number }>
  kind: 'demand' | 'budget'
  fy?: number
  lockedNote?: string
}) {
  const { data, reload, accountById } = useCrmData()
  const accounts = data!.accounts
  const [accountId, setAccountId] = useState(accounts[0]?.account_id ?? '')
  const [year, setYear] = useState(fy ?? currentFy())
  const [edits, setEdits] = useState<Map<string, string>>(new Map())
  const [extraSkus, setExtraSkus] = useState<string[]>([])
  const s = useSubmit()
  const months = monthRange(fyStart(year), 12)
  const account = accountById.get(accountId)
  const items = new Map(data!.priceList.map((p) => [p.sku, p]))

  const actual = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of data!.orders) if (o.account_id === accountId) m.set(`${o.sku}|${monthOf(o.order_date)}`, (m.get(`${o.sku}|${monthOf(o.order_date)}`) ?? 0) + o.order_qty)
    return m
  }, [data, accountId])

  const skus = useMemo(() => {
    const set = new Set(extraSkus)
    for (const k of values.keys()) {
      const [a, sku] = k.split('|')
      if (a === accountId) set.add(sku)
    }
    for (const k of actual.keys()) set.add(k.split('|')[0])
    return [...set].sort()
  }, [values, actual, accountId, extraSkus])

  const key = (sku: string, m: string) => `${accountId}|${sku}|${m}`
  const shown = (sku: string, m: string) => edits.get(key(sku, m)) ?? (values.has(key(sku, m)) ? String(values.get(key(sku, m))) : '')
  const num = (sku: string, m: string) => Number(shown(sku, m) || 0)
  const bad = [...edits.values()].some((v) => v.trim() !== '' && !/^\d+$/.test(v.trim()))
  const changes = [...edits.entries()].filter(([k, v]) => (values.has(k) ? String(values.get(k)) : '') !== v.trim())

  const switchAccount = (id: string) => {
    if (changes.length && !window.confirm('Discard unsaved changes?')) return
    setEdits(new Map())
    setExtraSkus([])
    setAccountId(id)
  }

  const doSave = () =>
    void s.run(async () => {
      const cells: Cell[] = changes.map(([k, v]) => {
        const [account_id, sku, month] = k.split('|')
        return { account_id, sku, month, qty: v.trim() === '' ? null : Number(v) }
      })
      const r = await save(cells)
      await reload()
      setEdits(new Map())
      return `Saved ${r.saved} cell(s)${r.removed ? `, removed ${r.removed}` : ''}.`
    })

  const unused = data!.priceList.filter((p: PriceItem) => !skus.includes(p.sku))
  const price = (sku: string) => netPrice(account, items.get(sku))
  const colTotal = (m: string) => skus.reduce((t, sku) => t + num(sku, m), 0)
  const amountTotal = skus.reduce((t, sku) => t + months.reduce((x, m) => x + num(sku, m), 0) * price(sku), 0)

  return (
    <>
      {lockedNote && <Notice kind="info">{lockedNote}</Notice>}
      <div className="filter-bar">
        <label className="inline-field">
          Account
          <select value={accountId} onChange={(e) => switchAccount(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.account_name} ({a.home_warehouse_id ?? 'no DC'})
              </option>
            ))}
          </select>
        </label>
        {kind === 'demand' && (
          <label className="inline-field">
            Fiscal year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[currentFy() - 1, currentFy(), currentFy() + 1].map((y) => (
                <option key={y} value={y}>
                  FY{y} (Jul {y - 1} – Jun {y})
                </option>
              ))}
            </select>
          </label>
        )}
        {canWrite && unused.length > 0 && (
          <label className="inline-field">
            Add SKU
            <select value="" onChange={(e) => e.target.value && setExtraSkus([...extraSkus, e.target.value])}>
              <option value="">Choose…</option>
              {unused.map((p) => (
                <option key={p.sku} value={p.sku}>
                  {p.sku} {p.product_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="primary" disabled={!canWrite || !changes.length || bad || s.saving} onClick={doSave}>
          {s.saving ? 'Saving…' : `Save${changes.length ? ` (${changes.length})` : ''}`}
        </button>
        {changes.length > 0 && (
          <button onClick={() => setEdits(new Map())} disabled={s.saving}>
            Discard
          </button>
        )}
      </div>
      {bad && <Notice kind="error">Quantities must be whole numbers of 0 or more.</Notice>}
      {s.result && (
        <Notice kind={s.result.kind} onClose={() => s.setResult(null)}>
          {s.result.text}
        </Notice>
      )}
      <div className="grid-wrap">
        <table className="grid plan-grid">
          <thead>
            <tr>
              <th>SKU</th>
              <th className="num">Net price</th>
              {months.map((m) => (
                <th key={m} className="num">
                  {monthLabel(m)}
                </th>
              ))}
              <th className="num">Total units</th>
              <th className="num">Total amount</th>
            </tr>
          </thead>
          <tbody>
            {skus.length === 0 && (
              <tr>
                <td colSpan={months.length + 4} className="empty">
                  No lines for this account yet{canWrite ? '. Use Add SKU to start.' : '.'}
                </td>
              </tr>
            )}
            {skus.flatMap((sku) => {
              const units = months.reduce((t, m) => t + num(sku, m), 0)
              const act = months.reduce((t, m) => t + (actual.get(`${sku}|${m}`) ?? 0), 0)
              return [
                <tr key={sku}>
                  <td>
                    <span className="mono">{sku}</span> <span className="muted small">{items.get(sku)?.product_name}</span>
                  </td>
                  <td className="num">{money2(price(sku))}</td>
                  {months.map((m) => {
                    const k = key(sku, m)
                    return (
                      <td key={m} className="num cell">
                        {canWrite ? (
                          <input
                            className={`cell-input${edits.has(k) ? ' changed' : ''}`}
                            inputMode="numeric"
                            value={shown(sku, m)}
                            aria-label={`${sku} ${monthLabel(m)}`}
                            onChange={(e) => setEdits(new Map(edits).set(k, e.target.value))}
                          />
                        ) : (
                          shown(sku, m) || '—'
                        )}
                      </td>
                    )
                  })}
                  <td className="num">{qty(units)}</td>
                  <td className="num">{money(units * price(sku))}</td>
                </tr>,
                <tr key={sku + '-actual'} className="muted">
                  <td className="small">&nbsp;&nbsp;Actual (ERP)</td>
                  <td />
                  {months.map((m) => (
                    <td key={m} className="num small">
                      {actual.get(`${sku}|${m}`) ?? ''}
                    </td>
                  ))}
                  <td className="num small">{act ? qty(act) : ''}</td>
                  <td />
                </tr>,
              ]
            })}
            {skus.length > 0 && (
              <tr className="total-row">
                <td>Total</td>
                <td />
                {months.map((m) => (
                  <td key={m} className="num">
                    {qty(colTotal(m))}
                  </td>
                ))}
                <td className="num">{qty(months.reduce((t, m) => t + colTotal(m), 0))}</td>
                <td className="num">{money(amountTotal)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function PriceListPage({ route }: { route: string }) {
  const { data } = useCrmData()
  return (
    <Page route={route} title="Price list" subtitle="List price per ERP SKU. Each customer pays the list price less their discount.">
      <DataGrid<PriceItem>
        rows={data!.priceList}
        rowKey={(p) => p.sku}
        columns={[
          { key: 'sku', header: 'SKU', render: (p) => <span className="mono">{p.sku}</span>, sortValue: (p) => p.sku },
          { key: 'name', header: 'Product', render: (p) => p.product_name, sortValue: (p) => p.product_name },
          { key: 'cat', header: 'Category', render: (p) => p.category ?? '—', sortValue: (p) => p.category },
          { key: 'price', header: 'List price', render: (p) => money2(p.list_price), numeric: true, sortValue: (p) => p.list_price },
          { key: 'cur', header: 'Currency', render: (p) => p.currency },
        ]}
      />
    </Page>
  )
}
