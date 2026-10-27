import { describe, expect, it } from 'vitest'
import { buildReport, forecastAccuracy, monthOf, monthRange, netPrice, pctDiff, weightedAmount, type ReportInput } from './plan'
import type { Account, CrmOrder } from './types'

const acc = (id: string, wh: string, disc = 0) => ({ account_id: id, home_warehouse_id: wh, discount_pct: disc }) as Account
const order = (id: string, account_id: string, sku: string, order_date: string, order_qty: number, unit_price: number) =>
  ({ erp_sales_order_id: id, account_id, sku, order_date, order_qty, unit_price }) as CrmOrder

const input: ReportInput = {
  accounts: [acc('ACC-1', 'KY-DC-01', 10), acc('ACC-2', 'OH-DC-01')],
  priceList: [
    { sku: 'UFS-1001', product_name: 'Shirt', category: 'Uniforms', list_price: 10, currency: 'USD' },
    { sku: 'PPE-2001', product_name: 'Gloves', category: 'PPE', list_price: 2, currency: 'USD' },
  ],
  forecasts: [
    { account_id: 'ACC-1', sku: 'UFS-1001', forecast_month: '2026-07-01', forecast_qty: 100, unit_price: 9, forecast_source: 'Customer' },
    { account_id: 'ACC-1', sku: 'UFS-1001', forecast_month: '2026-08-01', forecast_qty: 50, unit_price: null, forecast_source: 'Customer' },
    { account_id: 'ACC-2', sku: 'PPE-2001', forecast_month: '2026-07-01', forecast_qty: 10, unit_price: 2, forecast_source: 'Customer' },
  ],
  budgets: [
    { budget_version: 'V1', account_id: 'ACC-1', sku: 'UFS-1001', budget_month: '2026-07-01', budget_qty: 90, budget_amount: 810 },
    { budget_version: 'V2', account_id: 'ACC-1', sku: 'UFS-1001', budget_month: '2026-07-01', budget_qty: 999, budget_amount: 9999 },
    { budget_version: 'V1', account_id: 'ACC-2', sku: 'PPE-2001', budget_month: '2026-07-01', budget_qty: 12, budget_amount: 24 },
  ],
  orders: [
    order('SO-1', 'ACC-1', 'UFS-1001', '2026-07-03', 60, 9),
    order('SO-2', 'ACC-1', 'UFS-1001', '2026-07-30', 20, 9),
    order('SO-3', 'ACC-2', 'PPE-2001', '2026-07-15', 15, 2),
    order('SO-4', 'ACC-1', 'UFS-1001', '2026-06-30', 5, 9), // outside the range
  ],
}

describe('buildReport', () => {
  const f = { version: 'V1', from: '2026-07-01', to: '2026-08-01' }

  it('totals demand, budget (one version only) and actual', () => {
    const { total } = buildReport(input, f, 'month')
    expect(total).toEqual({ demandQty: 160, demandAmount: 100 * 9 + 50 * 9 + 10 * 2, budgetQty: 102, budgetAmount: 834, actualQty: 95, actualAmount: 80 * 9 + 30 })
  })

  it('groups by month, using the account price when a forecast has none', () => {
    const { rows } = buildReport(input, f, 'month')
    expect(rows.map((r) => r.key)).toEqual(['2026-07-01', '2026-08-01'])
    expect(rows[1]).toMatchObject({ demandQty: 50, demandAmount: 450, budgetQty: 0, actualQty: 0 })
  })

  it('groups by warehouse and filters by account, SKU and category', () => {
    expect(buildReport(input, f, 'warehouse').rows.map((r) => [r.key, r.actualQty])).toEqual([
      ['KY-DC-01', 80],
      ['OH-DC-01', 15],
    ])
    expect(buildReport(input, { ...f, accountId: 'ACC-2' }, 'sku').rows).toHaveLength(1)
    expect(buildReport(input, { ...f, category: 'Uniforms' }, 'sku').total.actualQty).toBe(80)
    expect(buildReport(input, { ...f, warehouse: 'OH-DC-01' }, 'account').rows[0].key).toBe('ACC-2')
  })
})

describe('helpers', () => {
  it('monthOf and monthRange', () => {
    expect(monthOf('2026-10-23')).toBe('2026-10-01')
    expect(monthRange('2026-11-01', 3)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01'])
  })
  it('netPrice rounds to cents', () => {
    expect(netPrice({ discount_pct: 12 }, { list_price: 34.23 })).toBe(30.12)
    expect(netPrice(undefined, undefined)).toBe(0)
  })
  it('pctDiff, forecastAccuracy and weightedAmount', () => {
    expect(pctDiff(110, 100)).toBeCloseTo(10)
    expect(pctDiff(5, 0)).toBeNull()
    expect(forecastAccuracy(100, 80)).toBe(80)
    expect(forecastAccuracy(100, 300)).toBe(0)
    expect(forecastAccuracy(0, 10)).toBeNull()
    expect(weightedAmount({ amount: 1000, probability_pct: 25, stage: 'Qualification' })).toBe(250)
    expect(weightedAmount({ amount: 1000, probability_pct: 100, stage: 'Closed Won' })).toBe(0)
  })
})
