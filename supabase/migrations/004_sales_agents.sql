-- ---------------------------------------------------------------------------
-- 004_sales_agents.sql  (ADDITIVE ONLY: no existing table is altered or dropped)
--
-- Sales order AI agents: stock check, approval, bin-level stock deduction,
-- shortage alerts and the weekly sales head summary.
--
--   ops.settings            recipients and limits (auto-approve limit, report threshold)
--   ops.customers           customer list copied from the CRM (accounts)
--   ops.price_list          selling prices copied from the CRM price list
--   ops.bins                bin locations and quantity per SKU and warehouse
--   ops.sales_order_ext     price, amount, customer, stock check and approval per order
--   ops.stock_movements     every bin deduction (audit trail)
--   ops.notifications       e-mails queued by the system (shortage alerts, weekly report)
--   ops.agent_runs          what each agent did and why
--
-- The browser reads through security_invoker views in `api` and writes only
-- through SECURITY DEFINER functions that check the operator role, like 001/002.
-- ---------------------------------------------------------------------------

create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;
grant usage on schema ops to authenticated;

create table ops.settings (
  key   text primary key,
  value text not null,
  note  text
);

create table ops.customers (
  account_id        text primary key,
  account_name      text not null,
  home_warehouse_id text,
  discount_pct      numeric(5,2) not null default 0
);

create table ops.price_list (
  sku        text primary key references raw.products (sku),
  list_price numeric(12,2) not null check (list_price >= 0),
  source     text not null default 'CRM price list'
);

create table ops.bins (
  bin_id        bigint generated always as identity primary key,
  warehouse_id  text not null,
  sku           text not null references raw.products (sku),
  bin_code      text not null,
  qty_on_hand   integer not null check (qty_on_hand >= 0),
  reorder_point integer not null default 0 check (reorder_point >= 0),
  unique (warehouse_id, bin_code, sku)
);
create index on ops.bins (sku, warehouse_id);

create table ops.sales_order_ext (
  sales_order_id     text primary key references raw.sales_orders (sales_order_id),
  account_id         text references ops.customers (account_id),
  unit_price         numeric(12,2) not null,
  amount             numeric(14,2) not null,
  requested_by       text not null,               -- 'Sales order agent' or the user's email
  request_text       text,                         -- the plain-English request, if any
  stock_status       text not null,                -- Available / Partial / Short
  available_at_check integer not null,
  approval_status    text not null default 'Pending'
                     check (approval_status in ('Pending', 'Approved', 'Needs Approval', 'Rejected')),
  decided_by         text,
  decision_reason    text,
  created_at         timestamptz not null default now(),
  decided_at         timestamptz
);

create table ops.stock_movements (
  movement_id    bigint generated always as identity primary key,
  bin_id         bigint not null references ops.bins (bin_id),
  sku            text not null,
  warehouse_id   text not null,
  sales_order_id text references raw.sales_orders (sales_order_id),
  qty_change     integer not null,
  qty_after      integer not null,
  movement_type  text not null default 'Shipment',
  created_by     text,
  created_at     timestamptz not null default now()
);

create table ops.notifications (
  notification_id bigint generated always as identity primary key,
  kind            text not null check (kind in ('Shortage alert', 'Weekly sales report')),
  recipient       text,                            -- null until the setting is filled in
  subject         text not null,
  body_html       text not null,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'Queued' check (status in ('Queued', 'Sent', 'Failed')),
  attempts        integer not null default 0,
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create table ops.agent_runs (
  run_id         bigint generated always as identity primary key,
  agent          text not null,                    -- 'Sales order agent' / 'Approver agent'
  sales_order_id text,
  input          text,
  output         jsonb,
  created_by     text,
  created_at     timestamptz not null default now()
);

alter table ops.settings        enable row level security;
alter table ops.customers       enable row level security;
alter table ops.price_list      enable row level security;
alter table ops.bins            enable row level security;
alter table ops.sales_order_ext enable row level security;
alter table ops.stock_movements enable row level security;
alter table ops.notifications   enable row level security;
alter table ops.agent_runs      enable row level security;

grant select on ops.customers, ops.price_list, ops.bins, ops.sales_order_ext,
                ops.stock_movements, ops.notifications, ops.agent_runs to authenticated;
create policy "erp users read customers"     on ops.customers       for select to authenticated using (api.current_erp_role() in ('viewer', 'operator'));
create policy "erp users read prices"        on ops.price_list      for select to authenticated using (api.current_erp_role() in ('viewer', 'operator'));
create policy "erp users read bins"          on ops.bins            for select to authenticated using (api.current_erp_role() in ('viewer', 'operator'));
create policy "erp users read so ext"        on ops.sales_order_ext for select to authenticated using (api.current_erp_role() in ('viewer', 'operator'));
create policy "erp users read movements"     on ops.stock_movements for select to authenticated using (api.current_erp_role() in ('viewer', 'operator'));
create policy "erp users read notifications" on ops.notifications   for select to authenticated using (api.current_erp_role() in ('viewer', 'operator'));
create policy "erp users read agent runs"    on ops.agent_runs      for select to authenticated using (api.current_erp_role() in ('viewer', 'operator'));
-- ops.settings holds e-mail addresses: no browser read at all.

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------
insert into ops.settings (key, value, note) values
  ('auto_approve_limit',   '1000', 'Orders up to this amount (USD) with stock available are approved automatically'),
  ('weekly_report_min',    '1000', 'The weekly report lists only orders above this amount (USD)'),
  ('sales_head_email',     '',     'Weekly sales report recipient'),
  ('inventory_team_email', '',     'Shortage alert recipient'),
  ('email_from',           'ERP Alerts <onboarding@resend.dev>', 'Sender used by the e-mail function');

-- Copied from the CRM seed (dharanig977/UniFirst_CRM db/seed/003_crm_seed.sql).
insert into ops.customers (account_id, account_name, home_warehouse_id, discount_pct) values
  ('ACC-1001', 'Bluegrass Metal Works',     'KY-DC-01', 12), ('ACC-1002', 'Derby City Foods',        'KY-DC-01', 6),
  ('ACC-1003', 'Cumberland Auto Parts',     'KY-DC-01', 12), ('ACC-1004', 'Lexington Health Partners','KY-DC-01', 6),
  ('ACC-1005', 'Ohio River Logistics',      'KY-DC-01', 0),  ('ACC-1006', 'Buckeye Steel Fabricators','OH-DC-01', 12),
  ('ACC-1007', 'Lake Erie Seafood Co',      'OH-DC-01', 6),  ('ACC-1008', 'Queen City Hospitality',   'OH-DC-01', 6),
  ('ACC-1009', 'Maumee Valley Plastics',    'OH-DC-01', 0),  ('ACC-1010', 'Dayton Aero Services',     'OH-DC-01', 12),
  ('ACC-1011', 'Music City Builders',       'TN-DC-01', 12), ('ACC-1012', 'Smoky Mountain Lodges',    'TN-DC-01', 6),
  ('ACC-1013', 'Memphis Freight Hub',       'TN-DC-01', 12), ('ACC-1014', 'Chattanooga Chemical',     'TN-DC-01', 6),
  ('ACC-1015', 'Volunteer Food Services',   'TN-DC-01', 0);

insert into ops.price_list (sku, list_price)
select v.sku, v.price from (values
  ('UFS-1001', 34.23), ('UFS-1002', 44.40), ('UFS-1003', 77.70), ('UFS-1004', 17.57), ('UFS-1005', 38.85),
  ('UFS-1006', 66.60), ('PPE-2001', 7.01),  ('PPE-2002', 11.14), ('PPE-2003', 20.46), ('PPE-2004', 5.12),
  ('PPE-2005', 14.69), ('FAC-3001', 42.62), ('FAC-3002', 8.68),  ('FAC-3003', 30.61)
) v(sku, price)
where exists (select 1 from raw.products p where p.sku = v.sku);

-- Bins: split today's on-hand (latest reconciliation row per SKU and warehouse)
-- into a primary bin (about 60%) and an overflow bin. Reorder point per bin = 10.
with latest as (
  select distinct on (sku, warehouse_id) sku, warehouse_id, greatest(adjusted_on_hand, 0)::int as on_hand
  from reporting.vw_inventory_reconciliation
  where warehouse_id <> 'TEST-01'
  order by sku, warehouse_id, snapshot_at desc
), numbered as (
  select l.*, row_number() over (partition by warehouse_id order by sku) as n from latest l
)
insert into ops.bins (warehouse_id, sku, bin_code, qty_on_hand, reorder_point)
select warehouse_id, sku, split_part(warehouse_id, '-', 1) || '-A-' || lpad(n::text, 2, '0') || '-01', ceil(on_hand * 0.6)::int, 10 from numbered
union all
select warehouse_id, sku, split_part(warehouse_id, '-', 1) || '-B-' || lpad(n::text, 2, '0') || '-02', on_hand - ceil(on_hand * 0.6)::int, 10 from numbered;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function ops.setting(p_key text) returns text
language sql stable set search_path = '' as $$
  select value from ops.settings where key = p_key
$$;

create or replace function ops.unit_price(p_sku text) returns numeric
language sql stable set search_path = '' as $$
  select coalesce((select list_price from ops.price_list where sku = p_sku),
                  (select unit_cost from raw.products where sku = p_sku), 0)
$$;

create or replace function ops.current_user_label() returns text
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'email', 'system')
$$;

-- Stock check: on hand in bins minus the open quantity of confirmed orders
-- (Open / Partially Shipped) that have not shipped yet.
create or replace function api.check_stock(p_sku text, p_warehouse_id text, p_qty integer, p_exclude_so text default null)
returns table (sku text, warehouse_id text, requested integer, on_hand integer, reserved integer, available integer, stock_status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_on_hand  integer;
  v_reserved integer;
  v_avail    integer;
begin
  if coalesce(api.current_erp_role(), '') not in ('viewer', 'operator')
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'NOT_ALLOWED: sign in with an ERP account' using errcode = '42501';
  end if;
  select coalesce(sum(b.qty_on_hand), 0) into v_on_hand
    from ops.bins b where b.sku = p_sku and b.warehouse_id = upper(p_warehouse_id);
  select coalesce(sum(greatest(s.order_qty - s.shipped_qty, 0)), 0) into v_reserved
    from raw.sales_orders s
   where s.sku = p_sku and s.warehouse_id = upper(p_warehouse_id)
     and s.status in ('Open', 'Partially Shipped')
     and s.sales_order_id is distinct from p_exclude_so;
  v_avail := greatest(v_on_hand - v_reserved, 0);
  return query select p_sku, upper(p_warehouse_id), p_qty, v_on_hand, v_reserved, v_avail,
    case when v_avail >= p_qty then 'Available' when v_avail > 0 then 'Partial' else 'Short' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approver: fixed rules decide, the AI agent may only add an explanation.
--   Stock Available and amount <= limit -> Approved (order confirmed, Draft -> Open)
--   Amount over the limit                -> Needs Approval (a person decides)
--   Stock Partial or Short               -> Needs Approval (a person decides)
-- ---------------------------------------------------------------------------
create or replace function api.auto_review_sales_order(p_sales_order_id text, p_explanation text default null)
returns ops.sales_order_ext
language plpgsql security definer set search_path = '' as $$
declare
  v_so    raw.sales_orders;
  v_ext   ops.sales_order_ext;
  v_stock record;
  v_limit numeric := coalesce(nullif(ops.setting('auto_approve_limit'), '')::numeric, 1000);
  v_decision text;
  v_reason   text;
begin
  if api.current_erp_role() is distinct from 'operator' then
    raise exception 'NOT_ALLOWED: only operators can run the approver' using errcode = '42501';
  end if;
  select * into v_so from raw.sales_orders where sales_order_id = p_sales_order_id for update;
  if not found then raise exception 'UNKNOWN_SO: % does not exist', p_sales_order_id using errcode = '22023'; end if;
  select * into v_ext from ops.sales_order_ext where sales_order_id = p_sales_order_id for update;
  if not found then raise exception 'NO_PRICE: % has no agent record', p_sales_order_id using errcode = '22023'; end if;
  if v_ext.approval_status <> 'Pending' then
    raise exception 'ALREADY_DECIDED: % is %', p_sales_order_id, v_ext.approval_status using errcode = '22023';
  end if;

  select * into v_stock from api.check_stock(v_so.sku, v_so.warehouse_id, v_so.order_qty, v_so.sales_order_id);

  if v_stock.stock_status <> 'Available' then
    v_decision := 'Needs Approval';
    v_reason := format('Stock is %s: %s requested, %s available in %s (%s on hand, %s reserved).',
                       v_stock.stock_status, v_so.order_qty, v_stock.available, v_so.warehouse_id, v_stock.on_hand, v_stock.reserved);
  elsif v_ext.amount > v_limit then
    v_decision := 'Needs Approval';
    v_reason := format('Amount $%s is above the auto-approve limit of $%s. Stock is available.',
                       to_char(v_ext.amount, 'FM999,999,990.00'), to_char(v_limit, 'FM999,999,990'));
  else
    v_decision := 'Approved';
    v_reason := format('Stock available (%s of %s) and amount $%s is within the $%s limit.',
                       v_stock.available, v_so.order_qty, to_char(v_ext.amount, 'FM999,999,990.00'), to_char(v_limit, 'FM999,999,990'));
  end if;

  if v_decision = 'Approved' and v_so.status = 'Draft' then
    update raw.sales_orders set status = 'Open' where sales_order_id = p_sales_order_id;
  end if;

  update ops.sales_order_ext
     set approval_status = v_decision,
         decided_by = case when v_decision = 'Approved' then 'Approver agent' else null end,
         decision_reason = coalesce(nullif(btrim(left(p_explanation, 600)), ''), v_reason),
         stock_status = v_stock.stock_status,
         available_at_check = v_stock.available,
         decided_at = case when v_decision = 'Approved' then now() else null end
   where sales_order_id = p_sales_order_id
  returning * into v_ext;

  insert into ops.agent_runs (agent, sales_order_id, input, output, created_by)
  values ('Approver agent', p_sales_order_id, null,
          jsonb_build_object('decision', v_decision, 'rule_reason', v_reason, 'explanation', p_explanation,
                             'stock', to_jsonb(v_stock), 'amount', v_ext.amount, 'limit', v_limit),
          ops.current_user_label());
  return v_ext;
end;
$$;

-- A person approves or rejects an order the agent held for review.
create or replace function api.decide_sales_order(p_sales_order_id text, p_approve boolean, p_note text default null)
returns ops.sales_order_ext
language plpgsql security definer set search_path = '' as $$
declare
  v_ext ops.sales_order_ext;
begin
  if api.current_erp_role() is distinct from 'operator' then
    raise exception 'NOT_ALLOWED: only operators can approve sales orders' using errcode = '42501';
  end if;
  select * into v_ext from ops.sales_order_ext where sales_order_id = p_sales_order_id for update;
  if not found then raise exception 'UNKNOWN_SO: % has no agent record', p_sales_order_id using errcode = '22023'; end if;
  if v_ext.approval_status not in ('Needs Approval', 'Pending') then
    raise exception 'ALREADY_DECIDED: % is %', p_sales_order_id, v_ext.approval_status using errcode = '22023';
  end if;
  if p_approve then
    update raw.sales_orders set status = 'Open' where sales_order_id = p_sales_order_id and status = 'Draft';
  end if;
  update ops.sales_order_ext
     set approval_status = case when p_approve then 'Approved' else 'Rejected' end,
         decided_by = ops.current_user_label(),
         decision_reason = coalesce(nullif(btrim(p_note), ''), case when p_approve then 'Approved by a person' else 'Rejected by a person' end),
         decided_at = now()
   where sales_order_id = p_sales_order_id
  returning * into v_ext;
  return v_ext;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sales order agent's write: create a Draft order with customer, price and
-- stock check, then send it to the approver rules.
-- ---------------------------------------------------------------------------
create or replace function api.agent_create_sales_order(
  p_account_id text, p_sku text, p_warehouse_id text, p_order_qty integer,
  p_request_text text default null, p_requested_by text default 'Sales order agent')
returns ops.sales_order_ext
language plpgsql security definer set search_path = '' as $$
declare
  v_so    raw.sales_orders;
  v_ext   ops.sales_order_ext;
  v_cust  ops.customers;
  v_stock record;
  v_price numeric;
begin
  if api.current_erp_role() is distinct from 'operator' then
    raise exception 'NOT_ALLOWED: only operators can create sales orders' using errcode = '42501';
  end if;
  select * into v_cust from ops.customers where account_id = upper(btrim(p_account_id));
  if not found then raise exception 'UNKNOWN_CUSTOMER: % does not exist', p_account_id using errcode = '22023'; end if;

  -- Reuses the validation in api.create_sales_order (product, warehouse, qty).
  select * into v_so from api.create_sales_order(p_sku, coalesce(nullif(btrim(p_warehouse_id), ''), v_cust.home_warehouse_id), p_order_qty, true);

  v_price := round(ops.unit_price(v_so.sku) * (1 - v_cust.discount_pct / 100), 2);
  select * into v_stock from api.check_stock(v_so.sku, v_so.warehouse_id, v_so.order_qty, v_so.sales_order_id);

  insert into ops.sales_order_ext (sales_order_id, account_id, unit_price, amount, requested_by, request_text,
                                   stock_status, available_at_check)
  values (v_so.sales_order_id, v_cust.account_id, v_price, round(v_price * v_so.order_qty, 2),
          coalesce(nullif(btrim(p_requested_by), ''), 'Sales order agent'), left(p_request_text, 2000),
          v_stock.stock_status, v_stock.available)
  returning * into v_ext;

  insert into ops.agent_runs (agent, sales_order_id, input, output, created_by)
  values ('Sales order agent', v_so.sales_order_id, left(p_request_text, 2000),
          jsonb_build_object('account_id', v_cust.account_id, 'sku', v_so.sku, 'warehouse_id', v_so.warehouse_id,
                             'qty', v_so.order_qty, 'unit_price', v_price, 'amount', v_ext.amount, 'stock', to_jsonb(v_stock)),
          ops.current_user_label());
  return v_ext;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ship an order: deduct from bins (fullest bin first), record movements,
-- update shipped_qty / status, then queue a shortage alert if needed.
-- ---------------------------------------------------------------------------
create or replace function api.ship_sales_order(p_sales_order_id text, p_qty integer default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_so        raw.sales_orders;
  v_ext       ops.sales_order_ext;
  v_remaining integer;
  v_to_ship   integer;
  v_left      integer;
  v_take      integer;
  v_shipped   integer := 0;
  v_bin       record;
  v_total     integer;
  v_reorder   integer;
  v_bins      jsonb;
  v_alert     bigint;
begin
  if api.current_erp_role() is distinct from 'operator' then
    raise exception 'NOT_ALLOWED: only operators can ship sales orders' using errcode = '42501';
  end if;
  select * into v_so from raw.sales_orders where sales_order_id = p_sales_order_id for update;
  if not found then raise exception 'UNKNOWN_SO: % does not exist', p_sales_order_id using errcode = '22023'; end if;
  if v_so.status not in ('Open', 'Partially Shipped') then
    raise exception 'NOT_SHIPPABLE: % has status "%"; only approved (Open) orders can ship', p_sales_order_id, v_so.status using errcode = '22023';
  end if;
  select * into v_ext from ops.sales_order_ext where sales_order_id = p_sales_order_id;
  if found and v_ext.approval_status <> 'Approved' then
    raise exception 'NOT_APPROVED: % is %', p_sales_order_id, v_ext.approval_status using errcode = '22023';
  end if;

  v_remaining := greatest(v_so.order_qty - v_so.shipped_qty, 0);
  v_to_ship := least(coalesce(p_qty, v_remaining), v_remaining);
  if v_to_ship <= 0 then raise exception 'NOTHING_TO_SHIP: % is fully shipped', p_sales_order_id using errcode = '22023'; end if;
  v_left := v_to_ship;

  for v_bin in
    select * from ops.bins where sku = v_so.sku and warehouse_id = v_so.warehouse_id and qty_on_hand > 0
    order by qty_on_hand desc, bin_code for update
  loop
    exit when v_left = 0;
    v_take := least(v_left, v_bin.qty_on_hand);
    update ops.bins set qty_on_hand = qty_on_hand - v_take where bin_id = v_bin.bin_id;
    insert into ops.stock_movements (bin_id, sku, warehouse_id, sales_order_id, qty_change, qty_after, created_by)
    values (v_bin.bin_id, v_so.sku, v_so.warehouse_id, v_so.sales_order_id, -v_take, v_bin.qty_on_hand - v_take, ops.current_user_label());
    v_left := v_left - v_take;
    v_shipped := v_shipped + v_take;
  end loop;

  if v_shipped > 0 then
    update raw.sales_orders
       set shipped_qty = shipped_qty + v_shipped,
           status = case when shipped_qty + v_shipped >= order_qty then 'Shipped' else 'Partially Shipped' end
     where sales_order_id = p_sales_order_id
    returning * into v_so;
  end if;

  -- Shortage check after the deduction.
  select coalesce(sum(qty_on_hand), 0), coalesce(sum(reorder_point), 0),
         coalesce(jsonb_agg(jsonb_build_object('bin_code', bin_code, 'qty_on_hand', qty_on_hand, 'reorder_point', reorder_point) order by bin_code), '[]'::jsonb)
    into v_total, v_reorder, v_bins
    from ops.bins where sku = v_so.sku and warehouse_id = v_so.warehouse_id;

  if v_left > 0 or v_total < v_reorder then
    insert into ops.notifications (kind, recipient, subject, body_html, payload)
    values ('Shortage alert', nullif(ops.setting('inventory_team_email'), ''),
            format('Stock shortage: %s at %s', v_so.sku, v_so.warehouse_id),
            ops.render_shortage_html(v_so.sku, v_so.warehouse_id, v_so.sales_order_id, v_left, v_total, v_reorder, v_bins),
            jsonb_build_object('sku', v_so.sku, 'warehouse_id', v_so.warehouse_id, 'sales_order_id', v_so.sales_order_id,
                               'qty_short', v_left, 'total_on_hand', v_total, 'reorder_point', v_reorder, 'bins', v_bins))
    returning notification_id into v_alert;
  end if;

  return jsonb_build_object('sales_order_id', v_so.sales_order_id, 'shipped_now', v_shipped, 'qty_short', v_left,
                            'status', v_so.status, 'total_on_hand_after', v_total, 'bins', v_bins, 'shortage_alert_id', v_alert);
end;
$$;

create or replace function ops.render_shortage_html(p_sku text, p_wh text, p_so text, p_short integer,
                                                    p_total integer, p_reorder integer, p_bins jsonb)
returns text language sql stable set search_path = '' as $$
  select format(
    '<h2>Stock shortage: %s at %s</h2>'
    '<p>Raised after shipping sales order <b>%s</b>.%s</p>'
    '<p>Total left in %s: <b>%s</b> (reorder point %s).</p>'
    '<table border="1" cellpadding="6" cellspacing="0"><tr><th>Bin</th><th>Qty on hand</th><th>Reorder point</th></tr>%s</table>'
    '<p>Product: %s</p>',
    p_sku, p_wh, p_so,
    case when p_short > 0 then format(' <b>%s units could not be picked</b>.', p_short) else '' end,
    p_wh, p_total, p_reorder,
    (select string_agg(format('<tr><td>%s</td><td align="right">%s</td><td align="right">%s</td></tr>',
                              b ->> 'bin_code', b ->> 'qty_on_hand', b ->> 'reorder_point'), '')
       from jsonb_array_elements(p_bins) b),
    (select product_name from raw.products where sku = p_sku))
$$;

-- ---------------------------------------------------------------------------
-- Weekly sales head report (previous Monday to Sunday).
-- Amount = agent price when known, otherwise qty x CRM list price.
-- ---------------------------------------------------------------------------
create or replace view ops.v_sales_order_amounts as
select s.sales_order_id, s.sku, s.warehouse_id, s.order_qty, s.order_date, s.status,
       e.account_id, c.account_name, e.approval_status,
       coalesce(e.unit_price, ops.unit_price(s.sku)) as unit_price,
       coalesce(e.amount, round(s.order_qty * ops.unit_price(s.sku), 2)) as amount
from raw.sales_orders s
left join ops.sales_order_ext e using (sales_order_id)
left join ops.customers c on c.account_id = e.account_id;

create or replace function ops.queue_weekly_sales_report(p_week_start date default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_start date := coalesce(p_week_start, date_trunc('week', current_date)::date - 7);
  v_end   date := coalesce(p_week_start, date_trunc('week', current_date)::date - 7) + 6;
  v_min   numeric := coalesce(nullif(ops.setting('weekly_report_min'), '')::numeric, 1000);
  v_count integer; v_total numeric; v_big_count integer; v_big_total numeric; v_rows text; v_id bigint;
begin
  select count(*), coalesce(sum(amount), 0),
         count(*) filter (where amount > v_min), coalesce(sum(amount) filter (where amount > v_min), 0)
    into v_count, v_total, v_big_count, v_big_total
    from ops.v_sales_order_amounts where order_date between v_start and v_end;
  select string_agg(format('<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td align="right">%s</td><td align="right">$%s</td><td>%s</td></tr>',
                           sales_order_id, order_date, coalesce(account_name, '-'), sku, order_qty,
                           to_char(amount, 'FM999,999,990.00'), coalesce(approval_status, status)), '' order by amount desc)
    into v_rows
    from ops.v_sales_order_amounts where order_date between v_start and v_end and amount > v_min;

  insert into ops.notifications (kind, recipient, subject, body_html, payload)
  values ('Weekly sales report', nullif(ops.setting('sales_head_email'), ''),
          format('Weekly sales orders %s to %s: %s orders, %s above $%s', v_start, v_end, v_count, v_big_count, to_char(v_min, 'FM999,990')),
          format('<h2>Sales orders raised %s to %s</h2>'
                 '<p>Orders raised: <b>%s</b>, total <b>$%s</b>.</p>'
                 '<p>Orders above $%s: <b>%s</b>, total <b>$%s</b>.</p>%s',
                 v_start, v_end, v_count, to_char(v_total, 'FM999,999,990.00'),
                 to_char(v_min, 'FM999,990'), v_big_count, to_char(v_big_total, 'FM999,999,990.00'),
                 case when v_rows is null then '<p>No orders above the threshold this week.</p>'
                      else '<table border="1" cellpadding="6" cellspacing="0"><tr><th>Order</th><th>Date</th><th>Customer</th><th>SKU</th><th>Qty</th><th>Amount</th><th>Status</th></tr>' || v_rows || '</table>' end),
          jsonb_build_object('week_start', v_start, 'week_end', v_end, 'orders', v_count, 'total', v_total,
                             'orders_above_min', v_big_count, 'total_above_min', v_big_total, 'min', v_min))
  returning notification_id into v_id;
  return v_id;
end;
$$;

-- Lets an operator queue the weekly report on demand (for testing from the app).
create or replace function api.queue_weekly_sales_report(p_week_start date default null)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  if api.current_erp_role() is distinct from 'operator' then
    raise exception 'NOT_ALLOWED: only operators can send the weekly report' using errcode = '42501';
  end if;
  return ops.queue_weekly_sales_report(p_week_start);
end;
$$;

-- ---------------------------------------------------------------------------
-- Read views for the app
-- ---------------------------------------------------------------------------
create view api.bins with (security_invoker = true) as
  select bin_id, warehouse_id, sku, bin_code, qty_on_hand, reorder_point from ops.bins;
create view api.customers with (security_invoker = true) as
  select account_id, account_name, home_warehouse_id, discount_pct from ops.customers;
create view api.price_list with (security_invoker = true) as
  select sku, list_price, source from ops.price_list;
create view api.sales_order_approvals with (security_invoker = true) as
  select e.sales_order_id, s.sku, s.warehouse_id, s.order_qty, s.shipped_qty, s.order_date, s.status,
         e.account_id, c.account_name, e.unit_price, e.amount, e.requested_by, e.request_text,
         e.stock_status, e.available_at_check, e.approval_status, e.decided_by, e.decision_reason,
         e.created_at, e.decided_at
  from ops.sales_order_ext e
  join raw.sales_orders s using (sales_order_id)
  left join ops.customers c on c.account_id = e.account_id;
-- Every order that still needs stock, with the automatic stock check.
create view api.sales_order_stock with (security_invoker = true) as
  select s.sales_order_id, s.sku, s.warehouse_id, s.status,
         greatest(s.order_qty - s.shipped_qty, 0) as open_qty,
         coalesce(b.on_hand, 0) as on_hand,
         coalesce(r.reserved_by_others, 0) as reserved_by_others,
         greatest(coalesce(b.on_hand, 0) - coalesce(r.reserved_by_others, 0), 0) as available,
         case when greatest(coalesce(b.on_hand, 0) - coalesce(r.reserved_by_others, 0), 0) >= greatest(s.order_qty - s.shipped_qty, 0) then 'Available'
              when greatest(coalesce(b.on_hand, 0) - coalesce(r.reserved_by_others, 0), 0) > 0 then 'Partial'
              else 'Short' end as stock_status
  from raw.sales_orders s
  left join lateral (select sum(qty_on_hand) as on_hand from ops.bins x where x.sku = s.sku and x.warehouse_id = s.warehouse_id) b on true
  left join lateral (select sum(greatest(o.order_qty - o.shipped_qty, 0)) as reserved_by_others
                       from raw.sales_orders o
                      where o.sku = s.sku and o.warehouse_id = s.warehouse_id and o.status in ('Open', 'Partially Shipped')
                        and o.sales_order_id <> s.sales_order_id) r on true
  where s.status in ('Draft', 'Open', 'Partially Shipped');
create view api.stock_movements with (security_invoker = true) as
  select movement_id, bin_id, sku, warehouse_id, sales_order_id, qty_change, qty_after, movement_type, created_by, created_at from ops.stock_movements;
create view api.notifications with (security_invoker = true) as
  select notification_id, kind, (recipient is not null) as has_recipient, subject, body_html, status, attempts, error, created_at, sent_at
  from ops.notifications;
create view api.agent_runs with (security_invoker = true) as
  select run_id, agent, sales_order_id, input, output, created_by, created_at from ops.agent_runs;

grant select on api.bins, api.customers, api.price_list, api.sales_order_approvals, api.sales_order_stock,
                api.stock_movements, api.notifications, api.agent_runs to authenticated;
revoke insert, update, delete, truncate on api.bins, api.customers, api.price_list, api.sales_order_approvals, api.sales_order_stock,
                api.stock_movements, api.notifications, api.agent_runs from authenticated, anon;

-- Function permissions: browser users run only the api.* functions; ops.* are internal.
revoke all on all functions in schema ops from public, anon, authenticated;
revoke all on function api.check_stock(text, text, integer, text) from public, anon;
revoke all on function api.auto_review_sales_order(text, text) from public, anon;
revoke all on function api.decide_sales_order(text, boolean, text) from public, anon;
revoke all on function api.agent_create_sales_order(text, text, text, integer, text, text) from public, anon;
revoke all on function api.ship_sales_order(text, integer) from public, anon;
revoke all on function api.queue_weekly_sales_report(date) from public, anon;
grant execute on function api.check_stock(text, text, integer, text) to authenticated;
grant execute on function api.auto_review_sales_order(text, text) to authenticated;
grant execute on function api.decide_sales_order(text, boolean, text) to authenticated;
grant execute on function api.agent_create_sales_order(text, text, text, integer, text, text) to authenticated;
grant execute on function api.ship_sales_order(text, integer) to authenticated;
grant execute on function api.queue_weekly_sales_report(date) to authenticated;
-- RLS policies call api.current_erp_role(); ops views call ops.unit_price.
grant execute on function ops.unit_price(text) to authenticated;
