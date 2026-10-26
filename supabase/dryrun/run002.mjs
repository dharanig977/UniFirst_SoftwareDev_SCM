// Dry run of 002_erp_modules.sql on top of 001, against the local replica.
//   node supabase/dryrun/run002.mjs supabase/dryrun/replica.sql supabase/migrations/001_erp_app_api.sql supabase/migrations/002_erp_modules.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
const [replica, m1, m2] = process.argv.slice(2)
const db = new PGlite()
for (const f of [replica, m1, m2]) await db.exec(readFileSync(f, 'utf8'))
console.log('001 + 002 applied cleanly to local replica.\n')
let pass = 0, fail = 0
async function as(claims, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); set role authenticated;`)
  try { return { rows: (await db.query(sql)).rows } } catch (e) { return { error: e.message } } finally { await db.exec('reset role') }
}
const check = (name, ok, info) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  -> ${info}` : ''}`) }
const op = { role: 'authenticated', app_metadata: { erp_role: 'operator' } }
const viewer = { role: 'authenticated', app_metadata: { erp_role: 'viewer' } }

let r = await as(op, "select * from api.create_purchase_order_draft('SUP-002','PPE-2002','TEST-01',10,current_date+5)")
check('draft PO created with status Draft', r.rows?.[0]?.status === 'Draft' && r.rows[0].po_id === 'PO-10004', JSON.stringify(r.rows?.[0] ?? r.error))
r = await as(op, "select * from api.create_purchase_order_draft('SUP-002','PPE-2002','TEST-01',0,current_date+5)"); check('draft PO still validates qty', /INVALID_QTY/.test(r.error ?? ''), r.error)
r = await as(op, "select * from api.record_goods_receipt('PO-10004',1,current_date)"); check('receipt against Draft PO rejected', /PO_IS_DRAFT/.test(r.error ?? ''), r.error)
r = await as(viewer, "select * from api.confirm_purchase_order('PO-10004')"); check('viewer cannot confirm PO', /NOT_ALLOWED/.test(r.error ?? ''), r.error)
r = await as(op, "select * from api.confirm_purchase_order('PO-10004')"); check('confirm Draft PO -> Open', r.rows?.[0]?.status === 'Open', JSON.stringify(r.rows?.[0] ?? r.error))
r = await as(op, "select * from api.confirm_purchase_order('PO-10004')"); check('confirming a non-draft rejected', /NOT_DRAFT/.test(r.error ?? ''), r.error)
r = await as(op, "select * from api.record_goods_receipt('PO-10004',3,current_date)"); check('receipt after confirm works', r.rows?.[0]?.receipt_id === 'GR-50003', JSON.stringify(r.rows?.[0] ?? r.error))
r = await as(op, "select * from api.record_goods_receipt('PO-10004',8,current_date)"); check('over-receipt still rejected', /OVER_RECEIPT/.test(r.error ?? ''), r.error)

r = await as(op, "select * from api.create_sales_order('UFS-1001','ky-dc-01',4,false)"); check('sales order -> SO-70004 Open, shipped 0', r.rows?.[0]?.sales_order_id === 'SO-70004' && r.rows[0].status === 'Open' && r.rows[0].shipped_qty === 0 && r.rows[0].warehouse_id === 'KY-DC-01', JSON.stringify(r.rows?.[0] ?? r.error))
r = await as(op, "select * from api.create_sales_order('UFS-1001','KY-DC-01',2,true)"); check('draft sales order -> SO-70005 Draft', r.rows?.[0]?.sales_order_id === 'SO-70005' && r.rows[0].status === 'Draft', JSON.stringify(r.rows?.[0] ?? r.error))
r = await as(op, "select * from api.confirm_sales_order('SO-70005')"); check('confirm draft SO -> Open', r.rows?.[0]?.status === 'Open')
r = await as(op, "select * from api.create_sales_order('NOPE-1','KY-DC-01',2,false)"); check('SO unknown SKU rejected', /UNKNOWN_PRODUCT/.test(r.error ?? ''), r.error)
r = await as(op, "select * from api.create_sales_order('UFS-1001','KY-DC-01',-1,false)"); check('SO negative qty rejected', /INVALID_QTY/.test(r.error ?? ''), r.error)
r = await as(viewer, "select * from api.create_sales_order('UFS-1001','KY-DC-01',1,false)"); check('viewer cannot create SO', /NOT_ALLOWED/.test(r.error ?? ''), r.error)

r = await as(op, "select * from api.create_product('ufs-1003','Hi-Vis Vest','Uniforms',12.5)"); check('create product UFS-1003', r.rows?.[0]?.sku === 'UFS-1003', JSON.stringify(r.rows?.[0] ?? r.error))
r = await as(op, "select * from api.create_product('UFS-1003','Dup','Uniforms',1)"); check('duplicate SKU rejected', /DUPLICATE_SKU/.test(r.error ?? ''), r.error)
r = await as(op, "select * from api.create_product('bad sku','X',null,1)"); check('bad SKU format rejected', /INVALID_SKU/.test(r.error ?? ''), r.error)
r = await as(op, "select * from api.create_product('UFS-1004','X',null,-2)"); check('negative cost rejected', /INVALID_COST/.test(r.error ?? ''), r.error)
r = await as(op, "select * from api.create_supplier('Acme Safety',6)"); check('create supplier -> SUP-003', r.rows?.[0]?.supplier_id === 'SUP-003', JSON.stringify(r.rows?.[0] ?? r.error))
r = await as(op, "select * from api.create_supplier('acme safety',6)"); check('duplicate supplier name rejected', /DUPLICATE_SUPPLIER/.test(r.error ?? ''), r.error)
r = await as(op, "select * from api.create_supplier('X',400)"); check('lead time > 365 rejected', /INVALID_LEAD_TIME/.test(r.error ?? ''), r.error)

await db.exec('reset role; set role anon;')
try { await db.query("select * from api.create_sales_order('UFS-1001','KY-DC-01',1,false)"); check('anon blocked', false) } catch (e) { check('anonymous cannot call new functions', true, e.message) }
await db.exec('reset role')
r = await db.query("select snapshot_qty, reserved_qty from raw.inventory_snapshots where snapshot_id='INV-90001'"); check('inventory snapshot untouched', r.rows[0].snapshot_qty === 20 && r.rows[0].reserved_qty === 5)
r = await db.query("select string_agg(po_id||':'||status, ',' order by po_id) s from raw.purchase_orders where po_id < 'PO-10004'"); check('original POs unchanged', r.rows[0].s === 'PO-10001:Open,PO-10002:Open,PO-10003:Partially Received', r.rows[0].s)
console.log(`\n${pass} passed, ${fail} failed`)
