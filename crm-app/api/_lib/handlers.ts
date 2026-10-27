// Every CRM API action. api/crm.ts wires these to real services; tests wire
// them to a local Postgres and stubbed sign-in.
import { HttpError, requireRead, requireWrite, type CrmUser } from './auth.js'
import type { Query } from './db.js'
import type { ErpOrderReader, ErpSalesOrder } from './erp.js'
import { cleanRecord, cleanValue, ENTITIES, month, qty, text } from './validate.js'

export interface Deps {
  query: Query
  tx: <T>(fn: (q: Query) => Promise<T>) => Promise<T>
  verify: (authHeader: string | null) => Promise<CrmUser>
  erpOrders: ErpOrderReader
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export async function handle(req: Request, deps: Deps): Promise<Response> {
  try {
    const user = await deps.verify(req.headers.get('authorization'))
    const r = new URL(req.url).searchParams.get('r') ?? ''
    if (req.method === 'GET') {
      requireRead(user)
      if (r === 'bootstrap') return json(await bootstrap(deps.query, user))
      throw new HttpError(404, `Unknown request "${r}".`)
    }
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')
    requireWrite(user)
    const body = await req.json().catch(() => {
      throw new HttpError(400, 'Request body must be JSON.')
    })
    switch (r) {
      case 'save':
        return json(await saveRecord(deps.query, body))
      case 'delete':
        return json(await softDelete(deps.query, body))
      case 'forecast':
        return json(await saveForecast(deps.tx, body))
      case 'budget':
        return json(await saveBudget(deps.tx, body))
      case 'budget-version':
        return json(await budgetVersion(deps.tx, body))
      case 'link-orders':
        return json(await linkOrders(deps, user, body))
    }
    throw new HttpError(404, `Unknown request "${r}".`)
  } catch (e) {
    return errorResponse(e)
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message }, e.status)
  const pg = e as { code?: string; message?: string; constraint?: string; name?: string }
  if (pg?.name === 'ConfigError') return json({ error: pg.message }, 500)
  switch (pg?.code) {
    case '23505':
      return json({ error: 'That record already exists.' }, 409)
    case '23503':
      return json({ error: 'It refers to an account, contact, product or version that does not exist.' }, 400)
    case '23514':
    case '22P02':
    case '22007':
    case '22008':
    case '22003':
      return json({ error: `A value is not allowed by the database rules${pg.constraint ? ` (${pg.constraint})` : ''}.` }, 400)
  }
  console.error(e)
  return json({ error: 'The CRM server hit an unexpected error. Try again; if it keeps happening, check the Vercel function logs.' }, 500)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function bootstrap(q: Query, user: CrmUser) {
  const live = (table: string, order: string) => q(`select * from crm.${table} where not is_deleted order by ${order}`)
  const [accounts, contacts, opportunities, activities, priceList, budgetVersions, forecasts, budgets, orders] = await Promise.all([
    live('accounts', 'account_name'),
    live('contacts', 'last_name, first_name'),
    live('opportunities', 'close_date'),
    live('activities', 'due_date nulls last'),
    live('price_list', 'sku'),
    live('budget_versions', 'fiscal_year desc, budget_version'),
    q(`select account_id, sku, forecast_month, forecast_qty, unit_price, forecast_source, updated_at
         from crm.demand_forecasts where not is_deleted order by forecast_month`),
    q(`select budget_version, account_id, sku, budget_month, budget_qty, budget_amount
         from crm.sales_budgets where not is_deleted order by budget_month`),
    live('orders', 'order_date desc, erp_sales_order_id'),
  ])
  return { me: { email: user.email, role: user.role }, accounts, contacts, opportunities, activities, priceList, budgetVersions, forecasts, budgets, orders }
}

// ---------------------------------------------------------------------------
// Accounts, contacts, opportunities, activities
// ---------------------------------------------------------------------------

function entityOf(body: { entity?: unknown }) {
  const spec = typeof body?.entity === 'string' ? ENTITIES[body.entity] : undefined
  if (!spec) throw new HttpError(400, 'Unknown record type.')
  return spec
}

async function saveRecord(q: Query, body: { entity?: unknown; id?: unknown; data?: unknown }) {
  const spec = entityOf(body)
  const id = typeof body.id === 'string' && body.id ? body.id : null
  const rec = cleanRecord(spec, body.data, id ? 'update' : 'insert')
  const cols = Object.keys(rec)
  const vals = Object.values(rec)
  if (id) {
    const set = cols.map((c, i) => `${c} = $${i + 2}`).join(', ')
    const rows = await q(`update crm.${spec.table} set ${set} where ${spec.key} = $1 and not is_deleted returning *`, [id, ...vals])
    if (!rows.length) throw new HttpError(404, `${id} was not found (it may have been deleted).`)
    return rows[0]
  }
  const rows = await q(`insert into crm.${spec.table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, vals)
  return rows[0]
}

/** Soft delete: the row stays (is_deleted = true) so the warehouse sees the deletion. */
async function softDelete(q: Query, body: { entity?: unknown; id?: unknown }) {
  const spec = entityOf(body)
  if (typeof body.id !== 'string' || !body.id) throw new HttpError(400, 'Missing id.')
  if (spec.table === 'accounts') {
    const [{ n }] = await q<{ n: number }>(`select count(*)::int n from crm.orders where account_id = $1 and not is_deleted`, [body.id])
    if (n > 0) throw new HttpError(409, `This account has ${n} linked ERP orders. Unlink them first, or set the account to Inactive instead.`)
  }
  const rows = await q(`update crm.${spec.table} set is_deleted = true where ${spec.key} = $1 and not is_deleted returning ${spec.key}`, [body.id])
  if (!rows.length) throw new HttpError(404, `${body.id} was not found.`)
  return { deleted: body.id }
}

// ---------------------------------------------------------------------------
// Demand forecasts and budgets (account x SKU x month)
// ---------------------------------------------------------------------------

interface Cell {
  account_id: string
  sku: string
  month: string
  qty: number | null
}

const MAX_CELLS = 2000

function cleanCells(raw: unknown): Cell[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'No changes to save.')
  if (raw.length > MAX_CELLS) throw new HttpError(400, `Too many changes at once (max ${MAX_CELLS}).`)
  return raw.map((c: Record<string, unknown>) => ({
    account_id: cleanValue(text('Account', { required: true }), c?.account_id) as string,
    sku: cleanValue(text('SKU', { required: true, upper: true }), c?.sku) as string,
    month: cleanValue(month('Month'), c?.month) as string,
    qty: cleanValue(qty('Quantity'), c?.qty) as number | null,
  }))
}

/** Saves forecast cells. A blank quantity removes (soft-deletes) the cell. */
async function saveForecast(tx: Deps['tx'], body: { cells?: unknown; source?: unknown }) {
  const cells = cleanCells(body.cells)
  const source = cleanValue(text('Source', { oneOf: ['Customer', 'Sales rep', 'Statistical'] }), body.source ?? 'Sales rep')
  return tx(async (q) => {
    let saved = 0
    let removed = 0
    for (const c of cells) {
      if (c.qty === null) {
        const r = await q(`update crm.demand_forecasts set is_deleted = true
                           where account_id = $1 and sku = $2 and forecast_month = $3 and not is_deleted returning 1`, [c.account_id, c.sku, c.month])
        removed += r.length
        continue
      }
      await q(
        `insert into crm.demand_forecasts as f (account_id, sku, forecast_month, forecast_qty, unit_price, forecast_source)
         select a.account_id, p.sku, $3::date, $4::int, round(p.list_price * (1 - a.discount_pct / 100), 2), $5::text
           from crm.accounts a, crm.price_list p
          where a.account_id = $1 and p.sku = $2 and not a.is_deleted and not p.is_deleted
         on conflict (account_id, sku, forecast_month) do update
           set forecast_qty = excluded.forecast_qty, forecast_source = excluded.forecast_source, is_deleted = false
           where f.forecast_qty is distinct from excluded.forecast_qty or f.is_deleted
              or f.forecast_source is distinct from excluded.forecast_source`,
        [c.account_id, c.sku, c.month, c.qty, source],
      )
      const ok = await q(`select 1 from crm.demand_forecasts where account_id = $1 and sku = $2 and forecast_month = $3 and not is_deleted`, [c.account_id, c.sku, c.month])
      if (!ok.length) throw new HttpError(400, `Unknown account ${c.account_id} or SKU ${c.sku}.`)
      saved++
    }
    return { saved, removed }
  })
}

async function draftVersion(q: Query, raw: unknown): Promise<string> {
  const version = cleanValue(text('Budget version', { required: true, max: 60 }), raw) as string
  const rows = await q<{ version_status: string }>(`select version_status from crm.budget_versions where budget_version = $1 and not is_deleted`, [version])
  if (!rows.length) throw new HttpError(404, `Budget version "${version}" was not found.`)
  if (rows[0].version_status !== 'Draft') throw new HttpError(409, `"${version}" is ${rows[0].version_status} and locked. Copy it to a new draft version to make changes.`)
  return version
}

/** Saves budget cells in a Draft version. budget_amount = qty x the account's net price. */
async function saveBudget(tx: Deps['tx'], body: { version?: unknown; cells?: unknown }) {
  const cells = cleanCells(body.cells)
  return tx(async (q) => {
    const version = await draftVersion(q, body.version)
    let saved = 0
    let removed = 0
    for (const c of cells) {
      if (c.qty === null) {
        const r = await q(`update crm.sales_budgets set is_deleted = true
                           where budget_version = $1 and account_id = $2 and sku = $3 and budget_month = $4 and not is_deleted returning 1`,
          [version, c.account_id, c.sku, c.month])
        removed += r.length
        continue
      }
      const rows = await q(
        `insert into crm.sales_budgets as b (budget_version, account_id, sku, budget_month, budget_qty, budget_amount)
         select $1, a.account_id, p.sku, $4::date, $5::int, round($5::int * round(p.list_price * (1 - a.discount_pct / 100), 2), 2)
           from crm.accounts a, crm.price_list p
          where a.account_id = $2 and p.sku = $3 and not a.is_deleted and not p.is_deleted
         on conflict (budget_version, account_id, sku, budget_month) do update
           set budget_qty = excluded.budget_qty, budget_amount = excluded.budget_amount, is_deleted = false
         returning 1`,
        [version, c.account_id, c.sku, c.month, c.qty],
      )
      if (!rows.length) throw new HttpError(400, `Unknown account ${c.account_id} or SKU ${c.sku}.`)
      saved++
    }
    return { saved, removed }
  })
}

/** Creates a draft version (optionally copied from another), or approves a draft. */
async function budgetVersion(tx: Deps['tx'], body: { action?: unknown; budget_version?: unknown; fiscal_year?: unknown; copy_from?: unknown; description?: unknown }) {
  return tx(async (q) => {
    if (body.action === 'approve') {
      const v = await draftVersion(q, body.budget_version)
      await q(`update crm.budget_versions set version_status = 'Approved' where budget_version = $1`, [v])
      return { approved: v }
    }
    if (body.action !== 'create') throw new HttpError(400, 'Unknown budget version action.')
    const v = cleanValue(text('Version name', { required: true, max: 60 }), body.budget_version) as string
    const fy = cleanValue({ kind: 'int', required: true, min: 2020, max: 2100, label: 'Fiscal year' }, body.fiscal_year) as number
    const description = cleanValue(text('Description', { max: 200 }), body.description)
    const exists = await q(`select 1 from crm.budget_versions where budget_version = $1`, [v])
    if (exists.length) throw new HttpError(409, `A version called "${v}" already exists.`)
    await q(`insert into crm.budget_versions (budget_version, fiscal_year, version_status, description) values ($1, $2, 'Draft', $3)`, [v, fy, description])
    let copied = 0
    if (body.copy_from) {
      const from = cleanValue(text('Copy from', { max: 60 }), body.copy_from) as string
      const rows = await q(
        `insert into crm.sales_budgets (budget_version, account_id, sku, budget_month, budget_qty, budget_amount)
         select $1, account_id, sku, budget_month, budget_qty, budget_amount
           from crm.sales_budgets where budget_version = $2 and not is_deleted returning 1`, [v, from])
      copied = rows.length
    }
    return { created: v, copied }
  })
}

// ---------------------------------------------------------------------------
// ERP sales order links
// ---------------------------------------------------------------------------

interface Candidate {
  account_id: string
  weight: number
}

/** Stable small hash, so auto-linking the same order always picks the same account. */
export function stableHash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Picks an account for an order, weighted by each candidate's budget for the SKU. */
export function pickAccount(orderId: string, candidates: Candidate[]): string | null {
  if (!candidates.length) return null
  const total = candidates.reduce((s, c) => s + Math.max(1, c.weight), 0)
  let n = stableHash(orderId) % total
  for (const c of [...candidates].sort((a, b) => a.account_id.localeCompare(b.account_id))) {
    n -= Math.max(1, c.weight)
    if (n < 0) return c.account_id
  }
  return candidates[0].account_id
}

const linkable = (o: ErpSalesOrder) =>
  !!o.sku && !!o.order_date && (o.order_qty ?? 0) > 0 && (o.status ?? '').trim().toLowerCase() !== 'draft'

async function linkOrders(deps: Deps, user: CrmUser, body: { mode?: unknown; sales_order_id?: unknown; account_id?: unknown }) {
  if (body.mode === 'unlink') {
    const id = cleanValue(text('Sales order', { required: true, upper: true }), body.sales_order_id) as string
    const rows = await deps.query(`update crm.orders set is_deleted = true where erp_sales_order_id = $1 and not is_deleted returning 1`, [id])
    if (!rows.length) throw new HttpError(404, `${id} is not linked.`)
    return { unlinked: id }
  }
  if (body.mode === 'manual') {
    const id = cleanValue(text('Sales order', { required: true, upper: true }), body.sales_order_id) as string
    const accountId = cleanValue(text('Account', { required: true }), body.account_id) as string
    const [order] = await deps.erpOrders(user.token, [id])
    if (!order) throw new HttpError(404, `ERP sales order ${id} was not found (or your ERP role cannot see it).`)
    if (!linkable(order)) throw new HttpError(400, `${id} is a draft or has no SKU, date or quantity, so it can't be linked yet.`)
    const rows = await deps.query(
      `insert into crm.orders as o (erp_sales_order_id, account_id, sku, order_date, order_qty, unit_price)
       select $1, a.account_id, p.sku, $4::date, $5::int, round(p.list_price * (1 - a.discount_pct / 100), 2)
         from crm.accounts a, crm.price_list p
        where a.account_id = $2 and p.sku = upper($3) and not a.is_deleted and not p.is_deleted
       on conflict (erp_sales_order_id) do update
         set account_id = excluded.account_id, sku = excluded.sku, order_date = excluded.order_date,
             order_qty = excluded.order_qty, unit_price = excluded.unit_price, is_deleted = false
       returning *`,
      [id, accountId, order.sku, order.order_date, order.order_qty],
    )
    if (!rows.length) throw new HttpError(400, `Unknown account ${accountId}, or SKU ${order.sku} has no CRM price yet.`)
    return { linked: rows[0] }
  }
  if (body.mode !== 'auto') throw new HttpError(400, 'Unknown link mode.')

  const orders = (await deps.erpOrders(user.token)).filter(linkable)
  return deps.tx(async (q) => {
    const existing = new Map(
      (await q<{ erp_sales_order_id: string; is_deleted: boolean; sku: string; order_date: string; order_qty: number }>(
        `select erp_sales_order_id, is_deleted, sku, order_date, order_qty from crm.orders`,
      )).map((r) => [r.erp_sales_order_id, r]),
    )
    // Candidate accounts per warehouse + SKU, weighted by total budget quantity.
    const cand = await q<{ home_warehouse_id: string; sku: string; account_id: string; weight: number }>(
      `select a.home_warehouse_id, b.sku, a.account_id, sum(b.budget_qty)::int weight
         from crm.accounts a join crm.sales_budgets b on b.account_id = a.account_id and not b.is_deleted
        where not a.is_deleted and a.account_status <> 'Inactive' and a.home_warehouse_id is not null
        group by 1, 2, 3
       union all
       select a.home_warehouse_id, f.sku, a.account_id, 0
         from crm.accounts a join crm.demand_forecasts f on f.account_id = a.account_id and not f.is_deleted
        where not a.is_deleted and a.account_status <> 'Inactive' and a.home_warehouse_id is not null
          and not exists (select 1 from crm.sales_budgets b where b.account_id = a.account_id and b.sku = f.sku and not b.is_deleted)
        group by 1, 2, 3`,
    )
    const byKey = new Map<string, Candidate[]>()
    for (const c of cand) {
      const k = `${c.home_warehouse_id}|${c.sku}`
      const list = byKey.get(k) ?? []
      list.push({ account_id: c.account_id, weight: c.weight })
      byKey.set(k, list)
    }
    let linked = 0
    let refreshed = 0
    let alreadyLinked = 0
    const skipped: { sales_order_id: string; reason: string }[] = []
    for (const o of orders) {
      const id = o.sales_order_id.toUpperCase()
      const prev = existing.get(id)
      if (prev?.is_deleted) {
        skipped.push({ sales_order_id: id, reason: 'Unlinked by hand earlier (link it manually to bring it back)' })
        continue
      }
      if (prev) {
        // Keep the copy of SKU/date/qty in step with the ERP; never change the chosen account or price.
        if (prev.sku !== o.sku!.toUpperCase() || prev.order_date !== o.order_date || prev.order_qty !== o.order_qty) {
          await q(`update crm.orders set sku = $2, order_date = $3, order_qty = $4 where erp_sales_order_id = $1`, [id, o.sku!.toUpperCase(), o.order_date, o.order_qty])
          refreshed++
        } else alreadyLinked++
        continue
      }
      const account = pickAccount(id, byKey.get(`${(o.warehouse_id ?? '').toUpperCase()}|${o.sku!.toUpperCase()}`) ?? [])
      if (!account) {
        skipped.push({ sales_order_id: id, reason: `No CRM account at ${o.warehouse_id ?? 'unknown warehouse'} plans to buy ${o.sku}` })
        continue
      }
      const rows = await q(
        `insert into crm.orders (erp_sales_order_id, account_id, sku, order_date, order_qty, unit_price)
         select $1, a.account_id, p.sku, $4::date, $5::int, round(p.list_price * (1 - a.discount_pct / 100), 2)
           from crm.accounts a, crm.price_list p where a.account_id = $2 and p.sku = $3 and not p.is_deleted
         on conflict do nothing returning 1`,
        [id, account, o.sku!.toUpperCase(), o.order_date, o.order_qty],
      )
      if (rows.length) linked++
      else skipped.push({ sales_order_id: id, reason: `SKU ${o.sku} has no CRM price` })
    }
    return { erpOrders: orders.length, linked, refreshed, alreadyLinked, skipped }
  })
}
