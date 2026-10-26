import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
const [replica, seed] = process.argv.slice(2)
const db = new PGlite()
await db.exec(readFileSync(replica, 'utf8'))
const before = (await db.query(`select snapshot_id, adjusted_on_hand, adjusted_available from reporting.vw_inventory_reconciliation order by 1`)).rows
await db.exec(readFileSync(seed, 'utf8'))
const after = (await db.query(`select snapshot_id, adjusted_on_hand, adjusted_available from reporting.vw_inventory_reconciliation where snapshot_id like 'INV-900%' order by 1`)).rows
console.log('existing recon unchanged:', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after))
const q = async (label, sql) => console.log(label, JSON.stringify((await db.query(sql)).rows))
await q('over-received POs:', `select p.po_id from raw.purchase_orders p join raw.goods_receipts g using (po_id) group by p.po_id, p.order_qty having sum(g.received_qty) > p.order_qty`)
await q('receipt sku/wh mismatch:', `select g.receipt_id from raw.goods_receipts g join raw.purchase_orders p using (po_id) where g.sku<>p.sku or g.warehouse_id<>p.warehouse_id`)
await q('receipts on drafts:', `select g.receipt_id from raw.goods_receipts g join raw.purchase_orders p using (po_id) where p.status='Draft'`)
await q('status vs qty mismatch:', `select p.po_id, p.status, p.order_qty, coalesce(sum(g.received_qty),0) r from raw.purchase_orders p left join raw.goods_receipts g using (po_id) where p.po_id like 'PO-11%' group by 1,2,3 having (p.status='Received') <> (coalesce(sum(g.received_qty),0) >= p.order_qty)`)
await q('bad SOs:', `select sales_order_id from raw.sales_orders where shipped_qty > order_qty or shipped_qty < 0`)
await q('neg snapshots:', `select snapshot_id from raw.inventory_snapshots where snapshot_qty < 0 or reserved_qty < 0`)
await q('future dates:', `select 'po' from raw.purchase_orders where order_date > '2026-10-26' union all select 'gr' from raw.goods_receipts where receipt_date > '2026-10-26' union all select 'so' from raw.sales_orders where order_date > '2026-10-26'`)
await q('counts:', `select (select count(*) from raw.products) products, (select count(*) from raw.suppliers) suppliers, (select count(*) from raw.purchase_orders) pos, (select count(*) from raw.goods_receipts) grs, (select count(*) from raw.sales_orders) sos, (select count(*) from raw.inventory_snapshots) snaps`)
try { await db.exec(readFileSync(seed, 'utf8')) } catch (e) { console.log('second run rejected:', e.message.slice(0, 80)) }
await db.exec('rollback')
await q('counts after rerun attempt:', `select (select count(*) from raw.purchase_orders) pos, (select count(*) from raw.sales_orders) sos`)
