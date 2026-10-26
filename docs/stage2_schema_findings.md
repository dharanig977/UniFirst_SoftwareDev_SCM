# Stage 2: What's in your Supabase database

Checked 2026-10-26 with read-only queries through the Supabase connector. Project: **Supply Chain Inventory Reconciliation_Dharani** (`epvnsalihzmnrkqcxkoc`, Postgres 17). Nothing was created, changed, or deleted.

## 1. Tables and columns (verified)

| Table | Primary key | Columns | Rows |
|---|---|---|---|
| `raw.products` | `sku` | sku, product_name, category, unit_cost | 4 |
| `raw.suppliers` | `supplier_id` | supplier_id, supplier_name, standard_lead_days | 2 |
| `raw.purchase_orders` | `po_id` | po_id, supplier_id → suppliers, sku → products, warehouse_id, order_qty, order_date, expected_date, status | 3 |
| `raw.goods_receipts` | `receipt_id` | receipt_id, po_id → purchase_orders, sku → products, warehouse_id, received_qty, receipt_date | 2 |
| `raw.sales_orders` | `sales_order_id` | sales_order_id, sku → products, warehouse_id, order_qty, shipped_qty, order_date, status | 3 |
| `raw.inventory_snapshots` | `snapshot_id` | snapshot_id, sku → products, warehouse_id, snapshot_qty, reserved_qty, snapshot_at | 3 |

All IDs are **text** with a prefix and number (`PO-10001`, `GR-50001`). There is no automatic ID generator, so the app must create the next ID safely to avoid duplicate primary keys.

There are **no CHECK constraints** (nothing stops a quantity of 0 or -5) and the foreign-key columns are **nullable**. The app and the write functions must do this validation themselves. There is no warehouse table, so warehouses are just text values seen in the data (`KY-DC-01`, `TN-DC-01`).

## 2. The reconciliation view

`reporting.vw_inventory_reconciliation` returns one row per snapshot:

```
adjusted_on_hand   = snapshot_qty + receipts at same SKU+warehouse dated AFTER the snapshot day
adjusted_available = adjusted_on_hand - reserved_qty
```

Business scenario, read straight from the view: **UFS-1001 @ KY-DC-01 → snapshot 20, receipt after snapshot 80, adjusted on-hand 100, reserved 5, adjusted available 95.** This matches your expected values. (This was verified with a database query, not yet through the app.)

Things worth knowing about the view's logic:
- It uses `receipt_date > snapshot day`, so a receipt on the **same day** as the snapshot is not added, even if it arrived after 08:00. Receipts only have a date, not a time, so this is a judgment call.
- It matches receipts by SKU + warehouse, not by PO.
- It does **not** subtract shipments made after the snapshot, so "adjusted on-hand" can overstate stock.

## 3. Security and permissions (the important part)

- **RLS is ON for all six tables, with zero policies.** Good: nothing is exposed.
- The browser roles (`anon`, `authenticated`) have **no access** to the `raw` or `reporting` schemas at all.
- There are **0 users** in Supabase Auth.

So right now, a browser app using the anon key can read **nothing**. That's the safe default. To make the app work, we have to deliberately grant a narrow set of permissions (see the decision in the thread).

Existing advisor warning, not caused by us: `public.rls_auto_enable()` is a SECURITY DEFINER function that anon users can call through the API. It only enables RLS on new tables, so the risk is low, but you may want to revoke `EXECUTE` from `anon` and `authenticated`. I have not changed it.

## 4. Data issues the app should surface (the "investigation" material)

Today is 2026-10-26.

1. **All 3 POs are overdue.** Expected dates 10-20, 10-25, 10-22, and none is fully received.
2. **PO-10001 status is stale.** It says `Open`, but 80 of 100 units were received (GR-50001), so it should be `Partially Received` with 20 still outstanding.
3. **UFS-1001 reserved quantity doesn't match sales orders.** The snapshot reserves 5, but SO-70001 has 12 ordered and 5 shipped, so 7 are still open.
4. **UFS-1002 @ TN-DC-01 has 10 reserved but no open sales order.** SO-70003 is fully shipped.
5. **PPE-2001 matches.** 60 reserved equals open SO-70002 (60).
6. **PO-10003's receipt (40 units on 10-21) came before the snapshot (10-23)**, so the view correctly doesn't add it again.

## 5. Operational transactions vs reporting

A goods receipt is an **operational transaction**: "80 units physically arrived on 10-24". The inventory snapshot is a **point-in-time count**: "we counted 20 at 08:00 on 10-23". Recording a receipt does **not** change the snapshot row, and no trigger does that here. Instead, the view **calculates** a current estimate (snapshot + later receipts). So when you record a receipt in the app, the snapshot table stays the same, and the Inventory screen's adjusted numbers go up because the view recalculates.
