// Demand vs Actual vs Budget: the numbers behind the report and the planning
// grids. Pure functions, so they are easy to test (plan.test.ts).
//   Demand = what the customer forecast (crm.demand_forecasts)
//   Budget = what we planned to sell (crm.sales_budgets, one version)
//   Actual = ERP sales orders linked to the customer (crm.orders)
import type { Account, Budget, CrmOrder, Forecast, PriceItem } from './types'

/** '2026-10-23' -> '2026-10-01' */
export const monthOf = (date: string) => date.slice(0, 7) + '-01'

/** n consecutive months starting at the month of `from` ('YYYY-MM-01' strings). */
export function monthRange(from: string, n: number): string[] {
  const y = Number(from.slice(0, 4))
  const m = Number(from.slice(5, 7)) - 1
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m + i, 1))
    return d.toISOString().slice(0, 10)
  })
}

export const monthLabel = (month: string) =>
  new Date(month + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })

/** The account's price for a SKU: list price less the account discount, rounded to cents. */
export function netPrice(account: Pick<Account, 'discount_pct'> | undefined, item: Pick<PriceItem, 'list_price'> | undefined): number {
  if (!item) return 0
  return Math.round(item.list_price * (1 - (account?.discount_pct ?? 0) / 100) * 100) / 100
}

export interface Measures {
  demandQty: number
  demandAmount: number
  budgetQty: number
  budgetAmount: number
  actualQty: number
  actualAmount: number
}

const zero = (): Measures => ({ demandQty: 0, demandAmount: 0, budgetQty: 0, budgetAmount: 0, actualQty: 0, actualAmount: 0 })

export type GroupBy = 'month' | 'account' | 'sku' | 'warehouse'

export interface ReportFilter {
  version: string
  from: string // first month, inclusive ('YYYY-MM-01')
  to: string // last month, inclusive
  accountId?: string
  sku?: string
  warehouse?: string
  category?: string
}

export interface ReportRow extends Measures {
  key: string
}

export interface ReportInput {
  accounts: Account[]
  priceList: PriceItem[]
  forecasts: Forecast[]
  budgets: Budget[]
  orders: CrmOrder[]
}

/** Builds Demand / Budget / Actual totals grouped by month, account, SKU or warehouse. */
export function buildReport(input: ReportInput, f: ReportFilter, groupBy: GroupBy): { rows: ReportRow[]; total: Measures } {
  const accounts = new Map(input.accounts.map((a) => [a.account_id, a]))
  const items = new Map(input.priceList.map((p) => [p.sku, p]))
  const keep = (accountId: string, sku: string, month: string) => {
    if (month < f.from || month > f.to) return false
    if (f.accountId && accountId !== f.accountId) return false
    if (f.sku && sku !== f.sku) return false
    const acc = accounts.get(accountId)
    if (f.warehouse && acc?.home_warehouse_id !== f.warehouse) return false
    if (f.category && items.get(sku)?.category !== f.category) return false
    return true
  }
  const keyOf = (accountId: string, sku: string, month: string) =>
    groupBy === 'month' ? month : groupBy === 'account' ? accountId : groupBy === 'sku' ? sku : (accounts.get(accountId)?.home_warehouse_id ?? '(none)')

  const groups = new Map<string, Measures>()
  const total = zero()
  const add = (k: string, field: keyof Measures, v: number) => {
    const g = groups.get(k) ?? zero()
    g[field] += v
    total[field] += v
    groups.set(k, g)
  }

  for (const r of input.forecasts) {
    if (!keep(r.account_id, r.sku, r.forecast_month)) continue
    const k = keyOf(r.account_id, r.sku, r.forecast_month)
    const price = r.unit_price ?? netPrice(accounts.get(r.account_id), items.get(r.sku))
    add(k, 'demandQty', r.forecast_qty)
    add(k, 'demandAmount', r.forecast_qty * price)
  }
  for (const r of input.budgets) {
    if (r.budget_version !== f.version || !keep(r.account_id, r.sku, r.budget_month)) continue
    const k = keyOf(r.account_id, r.sku, r.budget_month)
    add(k, 'budgetQty', r.budget_qty)
    add(k, 'budgetAmount', r.budget_amount)
  }
  for (const o of input.orders) {
    const month = monthOf(o.order_date)
    if (!keep(o.account_id, o.sku, month)) continue
    const k = keyOf(o.account_id, o.sku, month)
    add(k, 'actualQty', o.order_qty)
    add(k, 'actualAmount', o.order_qty * o.unit_price)
  }
  const rows = [...groups.entries()].map(([key, m]) => ({ key, ...m })).sort((a, b) => a.key.localeCompare(b.key))
  for (const k of Object.keys(total) as (keyof Measures)[]) total[k] = Math.round(total[k] * 100) / 100
  return { rows, total }
}

/** (a - b) / b as a percentage, or null when b is 0. */
export function pctDiff(a: number, b: number): number | null {
  return b === 0 ? null : ((a - b) / b) * 100
}

/**
 * Forecast accuracy = 1 - |actual - demand| / actual (0-100%), the usual
 * demand-planning measure. Null when there were no actuals.
 */
export function forecastAccuracy(actual: number, demand: number): number | null {
  if (actual <= 0) return null
  return Math.max(0, 1 - Math.abs(actual - demand) / actual) * 100
}

/** Weighted pipeline: amount x probability, for open opportunities. */
export function weightedAmount(o: { amount: number; probability_pct: number; stage: string }): number {
  return o.stage.startsWith('Closed') ? 0 : (o.amount * o.probability_pct) / 100
}
