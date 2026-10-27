// API tests against a real local Postgres. Run with:
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/crm_test npm test
// The test database is wiped and rebuilt from db/*.sql. Skipped when the variable is not set.
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HttpError, type CrmUser } from '../api/_lib/auth'
import { queryWith, transaction } from '../api/_lib/db'
import type { ErpSalesOrder } from '../api/_lib/erp'
import { handle, pickAccount, type Deps } from '../api/_lib/handlers'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

const ERP: ErpSalesOrder[] = [
  { sales_order_id: 'SO-71001', sku: 'UFS-1003', warehouse_id: 'OH-DC-01', order_qty: 19, order_date: '2026-07-02', status: 'Shipped' },
  { sales_order_id: 'SO-71021', sku: 'UFS-1003', warehouse_id: 'KY-DC-01', order_qty: 10, order_date: '2026-07-08', status: 'Shipped' },
  { sales_order_id: 'SO-71165', sku: 'PPE-2003', warehouse_id: 'TN-DC-01', order_qty: 15, order_date: '2026-10-26', status: 'Draft' },
  { sales_order_id: 'SO-70004', sku: 'PPE-2002', warehouse_id: 'TEST-01', order_qty: 2, order_date: '2026-10-26', status: 'Open' },
  { sales_order_id: 'SO-71097', sku: 'UFS-1006', warehouse_id: 'TN-DC-01', order_qty: 12, order_date: '2026-07-01', status: 'Shipped' },
]

suite('CRM API on local Postgres', () => {
  let pool: pg.Pool
  let deps: Deps
  const users: Record<string, CrmUser> = {
    op: { id: '1', email: 'op@example.com', role: 'operator', token: 'op' },
    viewer: { id: '2', email: 'v@example.com', role: 'viewer', token: 'viewer' },
    none: { id: '3', email: 'n@example.com', role: null, token: 'none' },
  }
  const call = async (method: 'GET' | 'POST', r: string, body?: unknown, who = 'op') => {
    const res = await handle(
      new Request(`http://x/api/crm?r=${r}`, { method, headers: { authorization: `Bearer ${who}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }),
      deps,
    )
    return { status: res.status, body: (await res.json()) as any }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 })
    await pool.query('drop schema if exists crm cascade')
    await pool.query(readFileSync('db/001_crm_schema.sql', 'utf8'))
    await pool.query(readFileSync('db/seed/003_crm_seed.sql', 'utf8'))
    deps = {
      query: queryWith(pool),
      tx: (fn) => transaction(pool, fn),
      verify: async (h) => {
        const u = users[h?.replace('Bearer ', '') ?? '']
        if (!u) throw new HttpError(401, 'Not signed in.')
        return u
      },
      erpOrders: async (_t, ids) => (ids ? ERP.filter((o) => ids.includes(o.sales_order_id)) : ERP),
    }
  })
  afterAll(async () => pool?.end())

  it('rejects calls without sign-in or role', async () => {
    expect((await call('GET', 'bootstrap', undefined, 'nobody')).status).toBe(401)
    expect((await call('GET', 'bootstrap', undefined, 'none')).status).toBe(403)
  })

  it('bootstrap returns the seeded data', async () => {
    const { status, body } = await call('GET', 'bootstrap', undefined, 'viewer')
    expect(status).toBe(200)
    expect(body.accounts).toHaveLength(15)
    expect(body.priceList).toHaveLength(14)
    expect(body.budgets).toHaveLength(576)
    expect(body.forecasts).toHaveLength(576)
    expect(body.budgets[0].budget_month).toMatch(/^\d{4}-\d{2}-01$/)
    expect(typeof body.budgets[0].budget_amount).toBe('number')
  })

  it('viewers cannot write', async () => {
    const r = await call('POST', 'save', { entity: 'accounts', data: { account_name: 'X', segment: 'Enterprise', account_status: 'Active' } }, 'viewer')
    expect(r.status).toBe(403)
  })

  it('creates, updates and soft-deletes an account', async () => {
    const c = await call('POST', 'save', { entity: 'accounts', data: { account_name: '  Test Co ', segment: 'Enterprise', account_status: 'Prospect', billing_state: 'ky', home_warehouse_id: 'ky-dc-01', discount_pct: '5' } })
    expect(c.status).toBe(200)
    expect(c.body.account_id).toBe('ACC-1016')
    expect(c.body.account_name).toBe('Test Co')
    expect(c.body.billing_state).toBe('KY')
    expect(c.body.home_warehouse_id).toBe('KY-DC-01')
    const u = await call('POST', 'save', { entity: 'accounts', id: 'ACC-1016', data: { account_status: 'Active' } })
    expect(u.body.account_status).toBe('Active')
    expect(new Date(u.body.updated_at) >= new Date(c.body.updated_at)).toBe(true)
    expect(u.body.created_at).toBe(c.body.created_at)
    const d = await call('POST', 'delete', { entity: 'accounts', id: 'ACC-1016' })
    expect(d.status).toBe(200)
    const [row] = (await pool.query(`select is_deleted, deleted_at from crm.accounts where account_id = 'ACC-1016'`)).rows
    expect(row.is_deleted).toBe(true)
    expect(row.deleted_at).not.toBeNull()
    expect((await call('POST', 'save', { entity: 'accounts', id: 'ACC-1016', data: { account_status: 'Active' } })).status).toBe(404)
  })

  it('validates input with readable messages', async () => {
    let r = await call('POST', 'save', { entity: 'accounts', data: { segment: 'Enterprise', account_status: 'Active' } })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('Account name is required.')
    r = await call('POST', 'save', { entity: 'opportunities', data: { account_id: 'ACC-1001', opportunity_name: 'X', stage: 'Won', amount: 1, probability_pct: 5, close_date: '2026-12-01' } })
    expect(r.body.error).toMatch(/Stage must be one of/)
    r = await call('POST', 'save', { entity: 'opportunities', data: { account_id: 'ACC-1001', opportunity_name: 'X', stage: 'Proposal', amount: 1, probability_pct: 5, close_date: '2026-02-30' } })
    expect(r.body.error).toMatch(/Close date must be a date/)
    r = await call('POST', 'save', { entity: 'contacts', data: { account_id: 'ACC-9999', first_name: 'A', last_name: 'B' } })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/does not exist/)
    r = await call('POST', 'save', { entity: 'users', data: {} })
    expect(r.body.error).toBe('Unknown record type.')
  })

  it('saves forecast cells, prices them, and blank removes', async () => {
    let r = await call('POST', 'forecast', { cells: [{ account_id: 'ACC-1001', sku: 'ufs-1001', month: '2027-07-01', qty: 40 }] })
    expect(r.body).toEqual({ saved: 1, removed: 0 })
    const [row] = (await pool.query(`select forecast_qty, unit_price from crm.demand_forecasts where account_id='ACC-1001' and sku='UFS-1001' and forecast_month='2027-07-01'`)).rows
    expect(row.forecast_qty).toBe(40)
    expect(Number(row.unit_price)).toBeCloseTo(18.5 * 1.85 * 0.88, 1)
    r = await call('POST', 'forecast', { cells: [{ account_id: 'ACC-1001', sku: 'UFS-1001', month: '2027-07-01', qty: null }] })
    expect(r.body).toEqual({ saved: 0, removed: 1 })
    r = await call('POST', 'forecast', { cells: [{ account_id: 'ACC-1001', sku: 'UFS-1001', month: '2027-07-15', qty: 1 }] })
    expect(r.body.error).toMatch(/first day of a month/)
    r = await call('POST', 'forecast', { cells: [{ account_id: 'ACC-1001', sku: 'NOPE-1', month: '2027-07-01', qty: 1 }] })
    expect(r.status).toBe(400)
  })

  it('locks approved budgets and copies them to a draft', async () => {
    const cell = { account_id: 'ACC-1001', sku: 'FAC-3001', month: '2026-07-01', qty: 99 }
    let r = await call('POST', 'budget', { version: 'FY2027 Original', cells: [cell] })
    expect(r.status).toBe(409)
    r = await call('POST', 'budget-version', { action: 'create', budget_version: 'FY2027 Reforecast', fiscal_year: 2027, copy_from: 'FY2027 Original' })
    expect(r.body.copied).toBeGreaterThan(0)
    r = await call('POST', 'budget', { version: 'FY2027 Reforecast', cells: [cell] })
    expect(r.body.saved).toBe(1)
    const [row] = (await pool.query(`select budget_qty, budget_amount from crm.sales_budgets where budget_version='FY2027 Reforecast' and account_id='ACC-1001' and sku='FAC-3001' and budget_month='2026-07-01'`)).rows
    expect(row.budget_qty).toBe(99)
    expect(Number(row.budget_amount)).toBeCloseTo(99 * (Math.round(Math.round(27.5 * 1.55 * 100) / 100 * 0.88 * 100) / 100), 2)
    r = await call('POST', 'budget-version', { action: 'approve', budget_version: 'FY2027 Reforecast' })
    expect(r.body.approved).toBe('FY2027 Reforecast')
    expect((await call('POST', 'budget', { version: 'FY2027 Reforecast', cells: [cell] })).status).toBe(409)
  })

  it('auto-links ERP orders to accounts at the same DC, skipping drafts and unknown DCs', async () => {
    const r = await call('POST', 'link-orders', { mode: 'auto' })
    expect(r.status).toBe(200)
    expect(r.body.erpOrders).toBe(4) // draft excluded
    expect(r.body.linked).toBe(3)
    expect(r.body.skipped.map((s: any) => s.sales_order_id)).toEqual(['SO-70004'])
    const rows = (await pool.query(`select o.*, a.home_warehouse_id from crm.orders o join crm.accounts a using (account_id) order by 1`)).rows
    expect(rows.map((x) => x.erp_sales_order_id)).toEqual(['SO-71001', 'SO-71021', 'SO-71097'])
    expect(rows.find((x) => x.erp_sales_order_id === 'SO-71001').home_warehouse_id).toBe('OH-DC-01')
    expect(rows.find((x) => x.erp_sales_order_id === 'SO-71021').home_warehouse_id).toBe('KY-DC-01')
    // Running again changes nothing.
    const again = await call('POST', 'link-orders', { mode: 'auto' })
    expect(again.body.linked).toBe(0)
    expect(again.body.alreadyLinked).toBe(3)
  })

  it('manual link, unlink, and auto respects a manual unlink', async () => {
    let r = await call('POST', 'link-orders', { mode: 'manual', sales_order_id: 'SO-71001', account_id: 'ACC-1007' })
    expect(r.body.linked.account_id).toBe('ACC-1007')
    r = await call('POST', 'link-orders', { mode: 'manual', sales_order_id: 'SO-71165', account_id: 'ACC-1011' })
    expect(r.status).toBe(400) // draft
    r = await call('POST', 'link-orders', { mode: 'unlink', sales_order_id: 'SO-71001' })
    expect(r.body.unlinked).toBe('SO-71001')
    r = await call('POST', 'link-orders', { mode: 'auto' })
    expect(r.body.linked).toBe(0)
    expect(r.body.skipped.map((s: any) => s.sales_order_id)).toContain('SO-71001')
    // An account with linked orders can't be deleted.
    const acc = (await pool.query(`select account_id from crm.orders where not is_deleted limit 1`)).rows[0].account_id
    expect((await call('POST', 'delete', { entity: 'accounts', id: acc })).status).toBe(409)
  })

  it('pickAccount is stable and follows the weights', () => {
    const c = [{ account_id: 'A', weight: 60 }, { account_id: 'B', weight: 40 }]
    expect(pickAccount('SO-1', c)).toBe(pickAccount('SO-1', c))
    const counts = { A: 0, B: 0 } as Record<string, number>
    for (let i = 0; i < 2000; i++) counts[pickAccount(`SO-${i}`, c)!]++
    expect(counts.A / 2000).toBeGreaterThan(0.5)
    expect(counts.A / 2000).toBeLessThan(0.7)
    expect(pickAccount('SO-1', [])).toBeNull()
  })
})
