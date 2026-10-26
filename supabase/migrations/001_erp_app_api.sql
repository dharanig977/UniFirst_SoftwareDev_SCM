-- =====================================================================
-- 001_erp_app_api.sql  (ADDITIVE ONLY: nothing is dropped, truncated,
-- reset, or disabled. Existing tables, data and the reporting view are
-- left exactly as they are.)
--
-- What this does, in plain words:
--   1. Creates a new schema `api`. The browser only talks to `api`.
--      `raw` and `reporting` stay private.
--   2. Read access: signed-in users whose admin-set ERP role is
--      "viewer" or "operator" can SELECT. Anonymous visitors get nothing.
--   3. Write access: no direct INSERT/UPDATE grants at all. Instead two
--      functions (create_purchase_order, record_goods_receipt) validate
--      everything, generate the next ID safely, and only run for the
--      "operator" role.
--
-- The ERP role lives in auth.users.raw_app_meta_data ("app_metadata"),
-- which users cannot edit themselves; only an admin can set it.
-- =====================================================================

create schema if not exists api;

-- Helper: the caller's ERP role from their login token (null if none).
create or replace function api.current_erp_role()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'erp_role', '')
$$;

-- ---------------------------------------------------------------------
-- 2. READ ACCESS (row level security stays ON; we add narrow SELECT policies)
-- ---------------------------------------------------------------------
grant usage on schema api to authenticated;
grant usage on schema raw to authenticated;
grant usage on schema reporting to authenticated;
grant execute on function api.current_erp_role() to authenticated;

grant select on raw.products, raw.suppliers, raw.purchase_orders,
                raw.goods_receipts, raw.sales_orders, raw.inventory_snapshots
  to authenticated;

create policy "erp users can read products" on raw.products
  for select to authenticated using (api.current_erp_role() in ('viewer', 'operator'));
create policy "erp users can read suppliers" on raw.suppliers
  for select to authenticated using (api.current_erp_role() in ('viewer', 'operator'));
create policy "erp users can read purchase orders" on raw.purchase_orders
  for select to authenticated using (api.current_erp_role() in ('viewer', 'operator'));
create policy "erp users can read goods receipts" on raw.goods_receipts
  for select to authenticated using (api.current_erp_role() in ('viewer', 'operator'));
create policy "erp users can read sales orders" on raw.sales_orders
  for select to authenticated using (api.current_erp_role() in ('viewer', 'operator'));
create policy "erp users can read inventory snapshots" on raw.inventory_snapshots
  for select to authenticated using (api.current_erp_role() in ('viewer', 'operator'));

-- Read-only views in `api`. security_invoker = true means the view runs with
-- the caller's permissions, so the RLS policies above still apply.
create view api.products with (security_invoker = true) as
  select sku, product_name, category, unit_cost from raw.products;
create view api.suppliers with (security_invoker = true) as
  select supplier_id, supplier_name, standard_lead_days from raw.suppliers;
create view api.purchase_orders with (security_invoker = true) as
  select po_id, supplier_id, sku, warehouse_id, order_qty, order_date, expected_date, status from raw.purchase_orders;
create view api.goods_receipts with (security_invoker = true) as
  select receipt_id, po_id, sku, warehouse_id, received_qty, receipt_date from raw.goods_receipts;
create view api.sales_orders with (security_invoker = true) as
  select sales_order_id, sku, warehouse_id, order_qty, shipped_qty, order_date, status from raw.sales_orders;
create view api.inventory_snapshots with (security_invoker = true) as
  select snapshot_id, sku, warehouse_id, snapshot_qty, reserved_qty, snapshot_at from raw.inventory_snapshots;

-- The existing reporting view runs with its owner's rights (it ignores RLS),
-- so this wrapper adds the same role check explicitly in its WHERE clause.
grant select on reporting.vw_inventory_reconciliation to authenticated;
create view api.inventory_reconciliation with (security_invoker = true) as
  select * from reporting.vw_inventory_reconciliation
  where api.current_erp_role() in ('viewer', 'operator');

grant select on api.products, api.suppliers, api.purchase_orders, api.goods_receipts,
                api.sales_orders, api.inventory_snapshots, api.inventory_reconciliation
  to authenticated;

-- ---------------------------------------------------------------------
-- 3. WRITE FUNCTIONS (SECURITY DEFINER: they run as the owner, so they can
--    insert even though users have no INSERT grant. That is why every check
--    happens inside them.)
-- ---------------------------------------------------------------------

-- Next ID like PO-10004: highest existing number + 1. The advisory lock makes
-- two simultaneous saves wait for each other, so IDs can never collide.
create or replace function api._next_id(p_table regclass, p_column text, p_prefix text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_max bigint;
begin
  perform pg_advisory_xact_lock(hashtext(p_table::text || '.' || p_column));
  execute format(
    'select max(substring(%I from %L)::bigint) from %s where %I ~ %L',
    p_column, '^' || p_prefix || '-(\d+)$', p_table, p_column, '^' || p_prefix || '-\d+$'
  ) into v_max;
  return p_prefix || '-' || (coalesce(v_max, 0) + 1)::text;
end;
$$;
revoke all on function api._next_id(regclass, text, text) from public, anon, authenticated;

create or replace function api.create_purchase_order(
  p_supplier_id   text,
  p_sku           text,
  p_warehouse_id  text,
  p_order_qty     integer,
  p_expected_date date
)
returns raw.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row raw.purchase_orders;
  v_wh  text := upper(btrim(p_warehouse_id));
begin
  if api.current_erp_role() is distinct from 'operator' then
    raise exception 'NOT_ALLOWED: only users with the operator ERP role can create purchase orders' using errcode = '42501';
  end if;
  if p_supplier_id is null or p_sku is null or v_wh is null or v_wh = '' or p_order_qty is null or p_expected_date is null then
    raise exception 'MISSING_FIELD: supplier, product, warehouse, quantity and expected date are all required' using errcode = '22023';
  end if;
  if p_order_qty <= 0 then
    raise exception 'INVALID_QTY: order quantity must be greater than zero (got %)', p_order_qty using errcode = '22023';
  end if;
  if p_order_qty > 1000000 then
    raise exception 'INVALID_QTY: order quantity % is unrealistically large', p_order_qty using errcode = '22023';
  end if;
  if v_wh !~ '^[A-Z0-9-]{2,20}$' then
    raise exception 'INVALID_WAREHOUSE: use letters, digits and dashes, e.g. KY-DC-01' using errcode = '22023';
  end if;
  if p_expected_date < current_date then
    raise exception 'INVALID_DATE: expected date % is in the past', p_expected_date using errcode = '22023';
  end if;
  if not exists (select 1 from raw.suppliers where supplier_id = p_supplier_id) then
    raise exception 'UNKNOWN_SUPPLIER: supplier % does not exist', p_supplier_id using errcode = '22023';
  end if;
  if not exists (select 1 from raw.products where sku = p_sku) then
    raise exception 'UNKNOWN_PRODUCT: product % does not exist', p_sku using errcode = '22023';
  end if;

  insert into raw.purchase_orders (po_id, supplier_id, sku, warehouse_id, order_qty, order_date, expected_date, status)
  values (api._next_id('raw.purchase_orders', 'po_id', 'PO'), p_supplier_id, p_sku, v_wh, p_order_qty, current_date, p_expected_date, 'Open')
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function api.record_goods_receipt(
  p_po_id         text,
  p_received_qty  integer,
  p_receipt_date  date
)
returns raw.goods_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po        raw.purchase_orders;
  v_received  bigint;
  v_remaining bigint;
  v_row       raw.goods_receipts;
begin
  if api.current_erp_role() is distinct from 'operator' then
    raise exception 'NOT_ALLOWED: only users with the operator ERP role can record receipts' using errcode = '42501';
  end if;
  if p_po_id is null or p_received_qty is null or p_receipt_date is null then
    raise exception 'MISSING_FIELD: purchase order, quantity and receipt date are required' using errcode = '22023';
  end if;
  if p_received_qty <= 0 then
    raise exception 'INVALID_QTY: received quantity must be greater than zero (got %)', p_received_qty using errcode = '22023';
  end if;
  if p_receipt_date > current_date then
    raise exception 'INVALID_DATE: receipt date % is in the future', p_receipt_date using errcode = '22023';
  end if;

  -- Lock the PO row so two receipts for the same PO can't both pass the check.
  select * into v_po from raw.purchase_orders where po_id = p_po_id for update;
  if not found then
    raise exception 'UNKNOWN_PO: purchase order % does not exist', p_po_id using errcode = '22023';
  end if;
  if v_po.order_date is not null and p_receipt_date < v_po.order_date then
    raise exception 'INVALID_DATE: receipt date % is before the order date %', p_receipt_date, v_po.order_date using errcode = '22023';
  end if;

  select coalesce(sum(received_qty), 0) into v_received from raw.goods_receipts where po_id = p_po_id;
  v_remaining := coalesce(v_po.order_qty, 0) - v_received;
  if p_received_qty > v_remaining then
    raise exception 'OVER_RECEIPT: % has % of % received, only % remain open; receiving % would over-receive by %',
      p_po_id, v_received, v_po.order_qty, greatest(v_remaining, 0), p_received_qty, p_received_qty - greatest(v_remaining, 0)
      using errcode = '22023';
  end if;

  insert into raw.goods_receipts (receipt_id, po_id, sku, warehouse_id, received_qty, receipt_date)
  values (api._next_id('raw.goods_receipts', 'receipt_id', 'GR'), v_po.po_id, v_po.sku, v_po.warehouse_id, p_received_qty, p_receipt_date)
  returning * into v_row;

  -- Keep the PO's status in step with its receipts (operational data only;
  -- the inventory snapshot is NOT touched).
  update raw.purchase_orders
     set status = case when v_received + p_received_qty >= coalesce(order_qty, 0) then 'Received' else 'Partially Received' end
   where po_id = p_po_id;

  return v_row;
end;
$$;

revoke all on function api.create_purchase_order(text, text, text, integer, date) from public, anon;
revoke all on function api.record_goods_receipt(text, integer, date) from public, anon;
grant execute on function api.create_purchase_order(text, text, text, integer, date) to authenticated;
grant execute on function api.record_goods_receipt(text, integer, date) to authenticated;
