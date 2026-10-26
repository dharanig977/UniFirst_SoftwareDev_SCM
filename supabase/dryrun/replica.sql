-- Local replica of the verified Supabase schema + data (dry run only).
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated;
create schema raw; create schema reporting;
create table raw.products (sku text primary key, product_name text not null, category text, unit_cost numeric);
create table raw.suppliers (supplier_id text primary key, supplier_name text not null, standard_lead_days integer);
create table raw.purchase_orders (po_id text primary key, supplier_id text references raw.suppliers(supplier_id), sku text references raw.products(sku), warehouse_id text, order_qty integer, order_date date, expected_date date, status text);
create table raw.goods_receipts (receipt_id text primary key, po_id text references raw.purchase_orders(po_id), sku text references raw.products(sku), warehouse_id text, received_qty integer, receipt_date date);
create table raw.sales_orders (sales_order_id text primary key, sku text references raw.products(sku), warehouse_id text, order_qty integer, shipped_qty integer, order_date date, status text);
create table raw.inventory_snapshots (snapshot_id text primary key, sku text references raw.products(sku), warehouse_id text, snapshot_qty integer, reserved_qty integer, snapshot_at timestamp);
alter table raw.products enable row level security; alter table raw.suppliers enable row level security;
alter table raw.purchase_orders enable row level security; alter table raw.goods_receipts enable row level security;
alter table raw.sales_orders enable row level security; alter table raw.inventory_snapshots enable row level security;
insert into raw.products values ('UFS-1001','Industrial Work Shirt','Uniforms',18.5),('UFS-1002','Safety Work Pants','Uniforms',24),('PPE-2001','Safety Gloves','PPE',4.25),('PPE-2002','Safety Glasses','PPE',6.75);
insert into raw.suppliers values ('SUP-001','Northstar Apparel Supply',7),('SUP-002','SafeHands Industrial',5);
insert into raw.purchase_orders values ('PO-10001','SUP-001','UFS-1001','KY-DC-01',100,'2026-10-10','2026-10-20','Open'),('PO-10002','SUP-002','PPE-2001','KY-DC-01',200,'2026-10-18','2026-10-25','Open'),('PO-10003','SUP-001','UFS-1002','TN-DC-01',75,'2026-10-12','2026-10-22','Partially Received');
insert into raw.goods_receipts values ('GR-50001','PO-10001','UFS-1001','KY-DC-01',80,'2026-10-24'),('GR-50002','PO-10003','UFS-1002','TN-DC-01',40,'2026-10-21');
insert into raw.sales_orders values ('SO-70001','UFS-1001','KY-DC-01',12,5,'2026-10-23','Partially Shipped'),('SO-70002','PPE-2001','KY-DC-01',60,0,'2026-10-24','Open'),('SO-70003','UFS-1002','TN-DC-01',20,20,'2026-10-20','Shipped');
insert into raw.inventory_snapshots values ('INV-90001','UFS-1001','KY-DC-01',20,5,'2026-10-23 08:00'),('INV-90002','PPE-2001','KY-DC-01',150,60,'2026-10-24 08:00'),('INV-90003','UFS-1002','TN-DC-01',35,10,'2026-10-23 08:00');
create view reporting.vw_inventory_reconciliation as
 SELECT i.snapshot_id, i.sku, p.product_name, i.warehouse_id, i.snapshot_qty, i.reserved_qty, i.snapshot_at,
    COALESCE(sum(g.received_qty) FILTER (WHERE g.receipt_date > i.snapshot_at::date), 0::bigint) AS receipt_after_snapshot,
    i.snapshot_qty + COALESCE(sum(g.received_qty) FILTER (WHERE g.receipt_date > i.snapshot_at::date), 0::bigint) AS adjusted_on_hand,
    i.snapshot_qty + COALESCE(sum(g.received_qty) FILTER (WHERE g.receipt_date > i.snapshot_at::date), 0::bigint) - i.reserved_qty AS adjusted_available
   FROM raw.inventory_snapshots i JOIN raw.products p ON p.sku = i.sku
     LEFT JOIN raw.goods_receipts g ON g.sku = i.sku AND g.warehouse_id = i.warehouse_id
  GROUP BY i.snapshot_id, i.sku, p.product_name, i.warehouse_id, i.snapshot_qty, i.reserved_qty, i.snapshot_at;
