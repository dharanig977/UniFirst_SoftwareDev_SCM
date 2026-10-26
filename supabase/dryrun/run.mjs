import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
const [replica, migration] = process.argv.slice(2)
const db = new PGlite()
await db.exec(readFileSync(replica, 'utf8'))
await db.exec(readFileSync(migration, 'utf8'))
console.log('Migration applied cleanly to local replica.\n')

let pass = 0, fail = 0
async function as(role, claims, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); set role ${role};`)
  try { return { rows: (await db.query(sql)).rows } } catch (e) { return { error: e.message } } finally { await db.exec('reset role') }
}
function check(name, cond, info) { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? `  -> ${info}` : ''}`) }
const op = { role: 'authenticated', app_metadata: { erp_role: 'operator' } }
const viewer = { role: 'authenticated', app_metadata: { erp_role: 'viewer' } }
const norole = { role: 'authenticated', app_metadata: {} }

let r = await as('authenticated', op, 'select count(*)::int n from api.suppliers'); check('operator reads suppliers', r.rows?.[0].n === 2, JSON.stringify(r))
r = await as('authenticated', op, 'select count(*)::int n from api.products'); check('operator reads products', r.rows?.[0].n === 4)
r = await as('authenticated', viewer, "select * from api.inventory_reconciliation where sku='UFS-1001'"); check('viewer reads view: UFS-1001 = 20/80/100/5/95', (()=>{const x=r.rows?.[0]; return x && x.snapshot_qty==20 && x.receipt_after_snapshot==80 && x.adjusted_on_hand==100 && x.reserved_qty==5 && x.adjusted_available==95})(), JSON.stringify(r.rows?.[0]))
r = await as('authenticated', norole, 'select count(*)::int n from api.purchase_orders'); check('user without ERP role sees 0 POs', r.rows?.[0].n === 0)
r = await as('authenticated', norole, 'select count(*)::int n from api.inventory_reconciliation'); check('user without ERP role sees 0 view rows', r.rows?.[0].n === 0)
r = await as('anon', {}, 'select * from api.products'); check('anonymous visitor is blocked', !!r.error, r.error)
r = await as('anon', {}, "select api.create_purchase_order('SUP-002','PPE-2002','KY-DC-01',10,current_date+5)"); check('anonymous cannot call create_purchase_order', !!r.error, r.error)
r = await as('authenticated', op, "insert into raw.purchase_orders(po_id) values ('PO-HACK')"); check('direct INSERT into raw table is blocked', !!r.error, r.error)
r = await as('authenticated', op, "update raw.purchase_orders set status='x'"); check('direct UPDATE of raw table is blocked', !!r.error, r.error)

r = await as('authenticated', viewer, "select * from api.create_purchase_order('SUP-002','PPE-2002','KY-DC-01',10,current_date+5)"); check('viewer cannot create PO', /NOT_ALLOWED/.test(r.error ?? ''), r.error)
r = await as('authenticated', op, "select * from api.create_purchase_order('SUP-002','PPE-2002','ky-dc-01',10,current_date+5)"); check('operator creates PO -> PO-10004', r.rows?.[0]?.po_id === 'PO-10004' && r.rows[0].status === 'Open' && r.rows[0].warehouse_id === 'KY-DC-01', JSON.stringify(r.rows?.[0] ?? r.error))
r = await as('authenticated', op, "select po_id from api.create_purchase_order('SUP-001','UFS-1001','KY-DC-01',5,current_date+5)"); check('next PO gets PO-10005 (no duplicate key)', r.rows?.[0]?.po_id === 'PO-10005', JSON.stringify(r))
for (const [name, args, code] of [
  ['rejects qty 0', "'SUP-002','PPE-2002','KY-DC-01',0,current_date+5", 'INVALID_QTY'],
  ['rejects negative qty', "'SUP-002','PPE-2002','KY-DC-01',-4,current_date+5", 'INVALID_QTY'],
  ['rejects unknown supplier', "'SUP-999','PPE-2002','KY-DC-01',10,current_date+5", 'UNKNOWN_SUPPLIER'],
  ['rejects unknown SKU', "'SUP-002','NOPE-1','KY-DC-01',10,current_date+5", 'UNKNOWN_PRODUCT'],
  ['rejects past expected date', "'SUP-002','PPE-2002','KY-DC-01',10,current_date-1", 'INVALID_DATE'],
  ['rejects missing warehouse', "'SUP-002','PPE-2002','  ',10,current_date+5", 'MISSING_FIELD'],
  ['rejects null quantity', "'SUP-002','PPE-2002','KY-DC-01',null,current_date+5", 'MISSING_FIELD'],
]) { r = await as('authenticated', op, `select api.create_purchase_order(${args})`); check(`create PO ${name}`, (r.error ?? '').includes(code), r.error) }

r = await as('authenticated', op, "select * from api.record_goods_receipt('PO-10004',6,current_date)"); check('record partial receipt -> GR-50003 with SKU/warehouse copied', r.rows?.[0]?.receipt_id === 'GR-50003' && r.rows[0].sku === 'PPE-2002' && r.rows[0].warehouse_id === 'KY-DC-01', JSON.stringify(r.rows?.[0] ?? r.error))
r = await as('authenticated', op, "select status from api.purchase_orders where po_id='PO-10004'"); check('PO status -> Partially Received', r.rows?.[0]?.status === 'Partially Received', JSON.stringify(r.rows))
r = await as('authenticated', op, "select api.record_goods_receipt('PO-10004',5,current_date)"); check('over-receipt (5 > 4 remaining) rejected', /OVER_RECEIPT/.test(r.error ?? ''), r.error)
r = await as('authenticated', op, "select receipt_id from api.record_goods_receipt('PO-10004',4,current_date)"); check('exact remaining (4) accepted -> GR-50004', r.rows?.[0]?.receipt_id === 'GR-50004', JSON.stringify(r))
r = await as('authenticated', op, "select status from api.purchase_orders where po_id='PO-10004'"); check('PO status -> Received', r.rows?.[0]?.status === 'Received')
r = await as('authenticated', op, "select api.record_goods_receipt('PO-10004',1,current_date)"); check('any receipt on a fully received PO rejected', /OVER_RECEIPT/.test(r.error ?? ''), r.error)
for (const [name, args, code] of [
  ['unknown PO', "'PO-99999',1,current_date", 'UNKNOWN_PO'],
  ['qty 0', "'PO-10002',0,current_date", 'INVALID_QTY'],
  ['future date', "'PO-10002',1,current_date+1", 'INVALID_DATE'],
  ['date before order date', "'PO-10002',1,'2026-10-01'", 'INVALID_DATE'],
]) { r = await as('authenticated', op, `select api.record_goods_receipt(${args})`); check(`receipt rejects ${name}`, (r.error ?? '').includes(code), r.error) }
r = await as('authenticated', viewer, "select api.record_goods_receipt('PO-10002',1,current_date)"); check('viewer cannot record receipt', /NOT_ALLOWED/.test(r.error ?? ''), r.error)

r = await db.query("select snapshot_qty, reserved_qty from raw.inventory_snapshots where snapshot_id='INV-90001'"); check('inventory snapshot untouched', r.rows[0].snapshot_qty === 20 && r.rows[0].reserved_qty === 5)
r = await db.query("select count(*)::int n from raw.purchase_orders where po_id in ('PO-10001','PO-10002','PO-10003')"); check('original POs still present', r.rows[0].n === 3)
console.log(`\n${pass} passed, ${fail} failed`)
