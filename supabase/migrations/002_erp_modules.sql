-- =====================================================================
-- 002_erp_modules.sql  (ADDITIVE ONLY, NOT YET APPLIED: needs approval)
--
-- Adds the write actions the module screens need. Same safety model as
-- 001: SECURITY DEFINER functions with all checks inside, operator role
-- only, IDs generated under a lock, no direct table grants.
--
--   Purchase  : save a PO as Draft, confirm a Draft PO (Draft -> Open)
--   Sales     : create a sales order (Draft or Open), confirm a Draft SO
--   Master data: create a product, create a supplier
--
-- One existing function from 001 is replaced: record_goods_receipt now
-- also refuses receipts against Draft POs (a draft is not yet sent to the
-- supplier, so nothing can arrive against it). Its other behaviour is
-- unchanged.
--
-- Nothing is dropped, no existing rows are changed, RLS stays on.
-- =====================================================================

-- ---------- Purchase: draft and confirm ----------

create or replace function api.create_purchase_order_draft(
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
begin
  -- Reuse every validation and the ID generator from create_purchase_order,
  -- then mark the new row as Draft inside the same transaction.
  v_row := api.create_purchase_order(p_supplier_id, p_sku, p_warehouse_id, p_order_qty, p_expected_date);
  update raw.purchase_orders set status = 'Draft' where po_id = v_row.po_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function api.confirm_purchase_order(p_po_id text)
returns raw.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row raw.purchase_orders;
begin
  if api.current_erp_role() is distinct from 'operator' then
    raise exception 'NOT_ALLOWED: only users with the operator ERP role can confirm purchase orders' using errcode = '42501';
  end if;
  select * into v_row from raw.purchase_orders where po_id = p_po_id for update;
  if not found then
    raise exception 'UNKNOWN_PO: purchase order % does not exist', p_po_id using errcode = '22023';
  end if;
  if v_row.status is distinct from 'Draft' then
    raise exception 'NOT_DRAFT: % has status "%"; only Draft orders can be confirmed', p_po_id, v_row.status using errcode = '22023';
  end if;
  update raw.purchase_orders set status = 'Open' where po_id = p_po_id returning * into v_row;
  return v_row;
end;
$$;

-- Same as 001, plus: no receipts against Draft POs.
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

  select * into v_po from raw.purchase_orders where po_id = p_po_id for update;
  if not found then
    raise exception 'UNKNOWN_PO: purchase order % does not exist', p_po_id using errcode = '22023';
  end if;
  if v_po.status = 'Draft' then
    raise exception 'PO_IS_DRAFT: % is still a Draft; confirm it before receiving goods', p_po_id using errcode = '22023';
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

  update raw.purchase_orders
     set status = case when v_received + p_received_qty >= coalesce(order_qty, 0) then 'Received' else 'Partially Received' end
   where po_id = p_po_id;

  return v_row;
end;
$$;

-- ---------- Sales: create and confirm ----------

create or replace function api.create_sales_order(
  p_sku          text,
  p_warehouse_id text,
  p_order_qty    integer,
  p_as_draft     boolean default false
)
returns raw.sales_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row raw.sales_orders;
  v_wh  text := upper(btrim(p_warehouse_id));
begin
  if api.current_erp_role() is distinct from 'operator' then
    raise exception 'NOT_ALLOWED: only users with the operator ERP role can create sales orders' using errcode = '42501';
  end if;
  if p_sku is null or v_wh is null or v_wh = '' or p_order_qty is null then
    raise exception 'MISSING_FIELD: product, warehouse and quantity are required' using errcode = '22023';
  end if;
  if p_order_qty <= 0 or p_order_qty > 1000000 then
    raise exception 'INVALID_QTY: order quantity must be between 1 and 1,000,000 (got %)', p_order_qty using errcode = '22023';
  end if;
  if v_wh !~ '^[A-Z0-9-]{2,20}$' then
    raise exception 'INVALID_WAREHOUSE: use letters, digits and dashes, e.g. KY-DC-01' using errcode = '22023';
  end if;
  if not exists (select 1 from raw.products where sku = p_sku) then
    raise exception 'UNKNOWN_PRODUCT: product % does not exist', p_sku using errcode = '22023';
  end if;

  insert into raw.sales_orders (sales_order_id, sku, warehouse_id, order_qty, shipped_qty, order_date, status)
  values (api._next_id('raw.sales_orders', 'sales_order_id', 'SO'), p_sku, v_wh, p_order_qty, 0, current_date,
          case when coalesce(p_as_draft, false) then 'Draft' else 'Open' end)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function api.confirm_sales_order(p_sales_order_id text)
returns raw.sales_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row raw.sales_orders;
begin
  if api.current_erp_role() is distinct from 'operator' then
    raise exception 'NOT_ALLOWED: only users with the operator ERP role can confirm sales orders' using errcode = '42501';
  end if;
  select * into v_row from raw.sales_orders where sales_order_id = p_sales_order_id for update;
  if not found then
    raise exception 'UNKNOWN_SO: sales order % does not exist', p_sales_order_id using errcode = '22023';
  end if;
  if v_row.status is distinct from 'Draft' then
    raise exception 'NOT_DRAFT: % has status "%"; only Draft orders can be confirmed', p_sales_order_id, v_row.status using errcode = '22023';
  end if;
  update raw.sales_orders set status = 'Open' where sales_order_id = p_sales_order_id returning * into v_row;
  return v_row;
end;
$$;

-- ---------- Master data: products and suppliers ----------

create or replace function api.create_product(
  p_sku          text,
  p_product_name text,
  p_category     text,
  p_unit_cost    numeric
)
returns raw.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row raw.products;
  v_sku text := upper(btrim(p_sku));
begin
  if api.current_erp_role() is distinct from 'operator' then
    raise exception 'NOT_ALLOWED: only users with the operator ERP role can create products' using errcode = '42501';
  end if;
  if v_sku is null or v_sku = '' or btrim(coalesce(p_product_name, '')) = '' then
    raise exception 'MISSING_FIELD: SKU and product name are required' using errcode = '22023';
  end if;
  if v_sku !~ '^[A-Z]{2,5}-[0-9]{3,6}$' then
    raise exception 'INVALID_SKU: use the existing pattern, e.g. UFS-1003 or PPE-2003' using errcode = '22023';
  end if;
  if p_unit_cost is not null and (p_unit_cost < 0 or p_unit_cost > 1000000) then
    raise exception 'INVALID_COST: unit cost must be between 0 and 1,000,000' using errcode = '22023';
  end if;
  -- SKUs are chosen by the user, so check for duplicates with a clear message
  -- (the primary key would also stop a duplicate).
  perform pg_advisory_xact_lock(hashtext('raw.products.sku'));
  if exists (select 1 from raw.products where sku = v_sku) then
    raise exception 'DUPLICATE_SKU: product % already exists', v_sku using errcode = '22023';
  end if;

  insert into raw.products (sku, product_name, category, unit_cost)
  values (v_sku, btrim(p_product_name), nullif(btrim(coalesce(p_category, '')), ''), p_unit_cost)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function api.create_supplier(
  p_supplier_name      text,
  p_standard_lead_days integer
)
returns raw.suppliers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row raw.suppliers;
  v_max bigint;
begin
  if api.current_erp_role() is distinct from 'operator' then
    raise exception 'NOT_ALLOWED: only users with the operator ERP role can create suppliers' using errcode = '42501';
  end if;
  if btrim(coalesce(p_supplier_name, '')) = '' then
    raise exception 'MISSING_FIELD: supplier name is required' using errcode = '22023';
  end if;
  if p_standard_lead_days is not null and (p_standard_lead_days < 0 or p_standard_lead_days > 365) then
    raise exception 'INVALID_LEAD_TIME: lead time must be between 0 and 365 days' using errcode = '22023';
  end if;
  if exists (select 1 from raw.suppliers where lower(supplier_name) = lower(btrim(p_supplier_name))) then
    raise exception 'DUPLICATE_SUPPLIER: a supplier named "%" already exists', btrim(p_supplier_name) using errcode = '22023';
  end if;

  -- Supplier IDs use three digits (SUP-001), so format the number to match.
  perform pg_advisory_xact_lock(hashtext('raw.suppliers.supplier_id'));
  select max(substring(supplier_id from '^SUP-(\d+)$')::bigint) into v_max
    from raw.suppliers where supplier_id ~ '^SUP-\d+$';
  insert into raw.suppliers (supplier_id, supplier_name, standard_lead_days)
  values ('SUP-' || lpad((coalesce(v_max, 0) + 1)::text, 3, '0'), btrim(p_supplier_name), p_standard_lead_days)
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------- Permissions: signed-in users only, never anonymous ----------
revoke all on function api.create_purchase_order_draft(text, text, text, integer, date) from public, anon;
revoke all on function api.confirm_purchase_order(text) from public, anon;
revoke all on function api.create_sales_order(text, text, integer, boolean) from public, anon;
revoke all on function api.confirm_sales_order(text) from public, anon;
revoke all on function api.create_product(text, text, text, numeric) from public, anon;
revoke all on function api.create_supplier(text, integer) from public, anon;
grant execute on function api.create_purchase_order_draft(text, text, text, integer, date) to authenticated;
grant execute on function api.confirm_purchase_order(text) to authenticated;
grant execute on function api.create_sales_order(text, text, integer, boolean) to authenticated;
grant execute on function api.confirm_sales_order(text) to authenticated;
grant execute on function api.create_product(text, text, text, numeric) to authenticated;
grant execute on function api.create_supplier(text, integer) to authenticated;
