"""Generate more synthetic supply-chain data for the raw schema.

Writes supabase/seed/more_sample_data.sql. The data comes from a small
day-by-day simulation, so it is internally consistent: stock never goes
negative, receipts never exceed the PO quantity, shipped never exceeds
ordered, and each snapshot's qty/reserved match the simulated stock and
open sales orders on that day.

Safety: insert-only, new ID ranges (PO-11xxx, GR-51xxx, SO-71xxx,
INV-91xxx), and nothing dated after an existing snapshot for an existing
item/warehouse, so the current reconciliation rows do not change.

Run:  python3 supabase/seed/generate_more_data.py
"""
import random
from datetime import date, datetime, timedelta
from pathlib import Path

random.seed(42)  # same output every run
START, TODAY = date(2026, 7, 1), date(2026, 10, 26)

NEW_SUPPLIERS = [
    # id, name, standard lead days
    ("SUP-004", "Bluegrass Textile Co", 10),
    ("SUP-005", "Midwest Safety Distributors", 6),
    ("SUP-006", "CleanCore Facility Products", 4),
    ("SUP-007", "Pacific Workwear Imports", 21),
]
NEW_PRODUCTS = [
    # sku, name, category, unit cost, supplier, daily demand (avg units), reorder point, order qty
    ("UFS-1003", "Flame-Resistant Coverall", "Uniforms", 42.00, "SUP-007", 3, 40, 120),
    ("UFS-1004", "High-Visibility Vest", "Uniforms", 9.50, "SUP-004", 6, 60, 200),
    ("UFS-1005", "Chef Coat", "Uniforms", 21.00, "SUP-004", 2, 25, 80),
    ("UFS-1006", "Insulated Work Jacket", "Uniforms", 36.00, "SUP-007", 2, 30, 90),
    ("PPE-2003", "Hard Hat", "PPE", 12.40, "SUP-005", 3, 35, 100),
    ("PPE-2004", "Ear Plugs (box of 200)", "PPE", 3.10, "SUP-005", 5, 50, 150),
    ("PPE-2005", "Nitrile Gloves (box of 100)", "PPE", 8.90, "SUP-002", 8, 80, 250),
    ("FAC-3001", "Anti-Fatigue Floor Mat", "Facility Services", 27.50, "SUP-006", 2, 20, 60),
    ("FAC-3002", "Hand Soap Refill", "Facility Services", 5.60, "SUP-006", 7, 70, 220),
    ("FAC-3003", "Paper Towel Case", "Facility Services", 19.75, "SUP-006", 4, 40, 120),
]
WAREHOUSES = ["KY-DC-01", "TN-DC-01", "OH-DC-01"]
LEAD = {s[0]: s[2] for s in NEW_SUPPLIERS} | {"SUP-001": 7, "SUP-002": 5}

pos, grs, sos, snaps = [], [], [], []
ids = {"po": 11000, "gr": 51000, "so": 71000, "inv": 91000}


def next_id(kind, prefix):
    ids[kind] += 1
    return f"{prefix}-{ids[kind]}"


def days(a, b):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def simulate(sku, wh, supplier, demand, rop, oq):
    stock = random.randint(rop, rop * 2)
    open_sos = []  # [so_dict, remaining]
    open_pos = []  # [po_dict, deliveries: list of (date, qty)]
    # Most items also get a top-up order in the last month (some still in transit today).
    top_up = TODAY - timedelta(days=random.randint(2, 30)) if random.random() < 0.7 else None
    for d in days(START, TODAY):
        # Snapshot every second Monday, 08:00, before the day's activity.
        if d.weekday() == 0 and (d - START).days // 7 % 2 == 0:
            snaps.append(dict(snapshot_id=next_id("inv", "INV"), sku=sku, warehouse_id=wh, snapshot_qty=stock,
                              reserved_qty=sum(r for _, r in open_sos), snapshot_at=datetime(d.year, d.month, d.day, 8)))
        # Receipts arriving today.
        for po, deliveries in open_pos:
            for when, qty in [x for x in deliveries if x[0] == d]:
                grs.append(dict(receipt_id=next_id("gr", "GR"), po_id=po["po_id"], sku=sku, warehouse_id=wh, received_qty=qty, receipt_date=d))
                po["_received"] += qty
                stock += qty
                deliveries.remove((when, qty))
        open_pos[:] = [p for p in open_pos if p[1]]
        # New customer orders (weekdays).
        if d.weekday() < 5 and random.random() < 0.2:
            qty = max(1, round(random.gauss(demand * 4.5, demand * 1.5)))
            so = dict(sales_order_id=next_id("so", "SO"), sku=sku, warehouse_id=wh, order_qty=qty, shipped_qty=0, order_date=d)
            sos.append(so)
            open_sos.append([so, qty])
        # Ship oldest orders first, as far as stock allows (weekdays).
        if d.weekday() < 5:
            for entry in open_sos:
                so, remaining = entry
                if random.random() < 0.6:
                    continue  # picking takes a few days; not every order ships today
                ship = min(remaining, stock)
                if ship > 0:
                    so["shipped_qty"] += ship
                    stock -= ship
                    entry[1] -= ship
            open_sos[:] = [e for e in open_sos if e[1] > 0]
        # Replenish when projected stock falls below the reorder point.
        on_order = sum(p["order_qty"] - p["_received"] for p, _ in open_pos)
        if (d == top_up and not open_pos) or d.weekday() < 5 and stock + on_order - sum(r for _, r in open_sos) < rop and d <= TODAY - timedelta(days=1):
            qty = oq // 2 + random.choice([0, 0, 10, 20, -10])
            lead = LEAD[supplier]
            po = dict(po_id=next_id("po", "PO"), supplier_id=supplier, sku=sku, warehouse_id=wh, order_qty=qty,
                      order_date=d, expected_date=d + timedelta(days=lead), _received=0)
            pos.append(po)
            arrive = d + timedelta(days=lead + random.choice([-2, -1, -1, 0, 0, 0, 0, 0, 1, 3, 6, 12]))
            if random.random() < 0.25:  # split delivery
                first = round(qty * random.uniform(0.4, 0.7))
                deliveries = [(arrive, first), (arrive + timedelta(days=random.randint(5, 14)), qty - first)]
            else:
                deliveries = [(arrive, qty)]
            open_pos.append([po, [x for x in deliveries]])


for sku, _, _, _, supplier, demand, rop, oq in NEW_PRODUCTS:
    for wh in random.sample(WAREHOUSES, 2):  # each item is stocked in 2 of the 3 DCs
        simulate(sku, wh, supplier, demand, rop, oq)

# History for the original items, closed well before their existing snapshots
# (2026-10-23/24), so the current reconciliation rows stay exactly the same.
for sku, wh, supplier in [("UFS-1001", "KY-DC-01", "SUP-001"), ("PPE-2001", "KY-DC-01", "SUP-002"),
                          ("UFS-1002", "TN-DC-01", "SUP-001"), ("PPE-2002", "KY-DC-01", "SUP-002")]:
    d = START + timedelta(days=random.randint(0, 6))
    while d < date(2026, 9, 20):
        qty = random.choice([60, 80, 100, 120, 150])
        lead = LEAD[supplier]
        po = dict(po_id=next_id("po", "PO"), supplier_id=supplier, sku=sku, warehouse_id=wh, order_qty=qty,
                  order_date=d, expected_date=d + timedelta(days=lead), _received=qty)
        pos.append(po)
        grs.append(dict(receipt_id=next_id("gr", "GR"), po_id=po["po_id"], sku=sku, warehouse_id=wh, received_qty=qty,
                        receipt_date=d + timedelta(days=lead + random.choice([-1, 0, 0, 1, 2, 4]))))
        for _ in range(random.randint(2, 4)):
            od = d + timedelta(days=random.randint(0, 12))
            q = random.randint(5, 30)
            sos.append(dict(sales_order_id=next_id("so", "SO"), sku=sku, warehouse_id=wh, order_qty=q, shipped_qty=q, order_date=od))
        d += timedelta(days=random.randint(14, 21))

# Status text, from quantities (matches how the app and api functions set it).
for po in pos:
    po["status"] = "Received" if po["_received"] >= po["order_qty"] else "Partially Received" if po["_received"] else "Open"
# A few very recent open POs saved as drafts, as a buyer would leave them.
for po in sorted([p for p in pos if p["status"] == "Open" and p["order_date"] >= TODAY - timedelta(days=10)], key=lambda p: p["order_date"])[-2:]:
    po["status"] = "Draft"
for so in sos:
    so["status"] = "Shipped" if so["shipped_qty"] >= so["order_qty"] else "Partially Shipped" if so["shipped_qty"] else "Open"
for so in sorted([s for s in sos if s["status"] == "Open"], key=lambda s: s["order_date"])[-2:]:
    so["status"] = "Draft"
# A draft PO can't have receipts (the app enforces this too).
assert not any(g["po_id"] == p["po_id"] for p in pos if p["status"] == "Draft" for g in grs)


def lit(v):
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, datetime):
        return f"'{v:%Y-%m-%d %H:%M:%S}'"
    if isinstance(v, date):
        return f"'{v:%Y-%m-%d}'"
    return "'" + str(v).replace("'", "''") + "'"


def insert(table, cols, rows):
    body = ",\n".join("  (" + ", ".join(lit(r[c]) for c in cols) + ")" for r in rows)
    return f"insert into {table} ({', '.join(cols)}) values\n{body};\n"


sql = [f"""-- =====================================================================
-- more_sample_data.sql: more SYNTHETIC data for the raw schema.
-- Generated by supabase/seed/generate_more_data.py (do not edit by hand).
--
-- INSERT ONLY. No existing row is changed or deleted. Runs as one
-- transaction: if any row fails (for example the file was already run,
-- so the IDs exist), nothing at all is inserted.
--
-- Adds: {len(NEW_SUPPLIERS)} suppliers, {len(NEW_PRODUCTS)} products, {len(pos)} purchase orders,
--       {len(grs)} goods receipts, {len(sos)} sales orders, {len(snaps)} inventory snapshots
-- Period {START} to {TODAY}; new warehouse OH-DC-01 (Columbus, OH).
-- Existing item/warehouse snapshots (INV-90001..90003) get no new rows
-- dated after them, so their reconciliation values do not change.
-- =====================================================================
begin;
"""]
sql.append(insert("raw.suppliers", ["supplier_id", "supplier_name", "standard_lead_days"],
                  [dict(supplier_id=a, supplier_name=b, standard_lead_days=c) for a, b, c in NEW_SUPPLIERS]))
sql.append(insert("raw.products", ["sku", "product_name", "category", "unit_cost"],
                  [dict(sku=p[0], product_name=p[1], category=p[2], unit_cost=p[3]) for p in NEW_PRODUCTS]))
sql.append(insert("raw.purchase_orders", ["po_id", "supplier_id", "sku", "warehouse_id", "order_qty", "order_date", "expected_date", "status"], pos))
sql.append(insert("raw.goods_receipts", ["receipt_id", "po_id", "sku", "warehouse_id", "received_qty", "receipt_date"], grs))
sql.append(insert("raw.sales_orders", ["sales_order_id", "sku", "warehouse_id", "order_qty", "shipped_qty", "order_date", "status"], sos))
sql.append(insert("raw.inventory_snapshots", ["snapshot_id", "sku", "warehouse_id", "snapshot_qty", "reserved_qty", "snapshot_at"], snaps))
sql.append("commit;\n")
out = Path(__file__).with_name("more_sample_data.sql")
out.write_text("\n".join(sql))
stat = lambda rows, key: {s: sum(1 for r in rows if r["status"] == s) for s in sorted({r["status"] for r in rows})}
print(f"wrote {out}: {len(pos)} POs {stat(pos, 'status')}, {len(grs)} receipts, {len(sos)} SOs {stat(sos, 'status')}, {len(snaps)} snapshots")
late = sum(1 for p in pos for g in grs if g["po_id"] == p["po_id"] and g["receipt_date"] > p["expected_date"])
print(f"late receipt lines: {late}; overdue open POs: {sum(1 for p in pos if p['status'] in ('Open','Partially Received') and p['expected_date'] < TODAY)}")
