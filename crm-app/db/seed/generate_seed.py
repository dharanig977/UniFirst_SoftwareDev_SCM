"""Generates db/seed/003_crm_seed.sql: synthetic CRM data that lines up with the ERP.

- SKUs and prices: every ERP SKU (except the TST test SKU), price = ERP unit_cost x markup.
- 15 accounts, 5 per ERP distribution centre (KY-DC-01, OH-DC-01, TN-DC-01).
- Each (DC, SKU) pair the ERP actually sells is bought by two accounts at that DC,
  so every real ERP sales order can be linked to a customer.
- Budget (version "FY2027 Original", Jul 2026 - Jun 2027) and demand forecasts are
  sized from the ERP's real average monthly sales per DC x SKU (Jul-Oct 2026).

Deterministic (fixed random seed). Every insert is ON CONFLICT DO NOTHING, so
the file is safe to run again and never overwrites edits made in the app.

    python3 db/seed/generate_seed.py > db/seed/003_crm_seed.sql
"""
import random
from datetime import date

rng = random.Random(20261026)

# From ERP raw.products (checked 2026-10-26): sku -> (name, category, unit_cost)
PRODUCTS = {
    "UFS-1001": ("Industrial Work Shirt", "Uniforms", 18.50),
    "UFS-1002": ("Safety Work Pants", "Uniforms", 24.00),
    "UFS-1003": ("Flame-Resistant Coverall", "Uniforms", 42.00),
    "UFS-1004": ("High-Visibility Vest", "Uniforms", 9.50),
    "UFS-1005": ("Chef Coat", "Uniforms", 21.00),
    "UFS-1006": ("Insulated Work Jacket", "Uniforms", 36.00),
    "PPE-2001": ("Safety Gloves", "PPE", 4.25),
    "PPE-2002": ("Safety Glasses", "PPE", 6.75),
    "PPE-2003": ("Hard Hat", "PPE", 12.40),
    "PPE-2004": ("Ear Plugs (box of 200)", "PPE", 3.10),
    "PPE-2005": ("Nitrile Gloves (box of 100)", "PPE", 8.90),
    "FAC-3001": ("Anti-Fatigue Floor Mat", "Facility Services", 27.50),
    "FAC-3002": ("Hand Soap Refill", "Facility Services", 5.60),
    "FAC-3003": ("Paper Towel Case", "Facility Services", 19.75),
}
MARKUP = {"Uniforms": 1.85, "PPE": 1.65, "Facility Services": 1.55}

# Average units sold per month in the ERP, Jul-Oct 2026, excluding drafts and TEST-01.
ERP_AVG_MONTH = {
    "KY-DC-01": {"FAC-3001": 32, "FAC-3003": 90, "PPE-2001": 81, "PPE-2002": 80, "PPE-2005": 144,
                 "UFS-1001": 86, "UFS-1003": 60, "UFS-1004": 70, "UFS-1005": 38},
    "OH-DC-01": {"FAC-3002": 222, "FAC-3003": 92, "PPE-2003": 57, "PPE-2004": 88, "PPE-2005": 139,
                 "UFS-1003": 74, "UFS-1004": 86, "UFS-1005": 37, "UFS-1006": 33},
    "TN-DC-01": {"FAC-3001": 45, "FAC-3002": 159, "PPE-2003": 67, "PPE-2004": 43,
                 "UFS-1002": 66, "UFS-1006": 38},
}

# Fictional customers. (name, industry, segment, city)
ACCOUNTS = {
    "KY-DC-01": [
        ("Bluegrass Metal Works", "Manufacturing", "Enterprise", "Louisville"),
        ("Derby City Foods", "Food Processing", "Mid-Market", "Louisville"),
        ("Cumberland Auto Parts", "Automotive", "Enterprise", "Bowling Green"),
        ("Lexington Health Partners", "Healthcare", "Mid-Market", "Lexington"),
        ("Ohio River Logistics", "Logistics", "Small Business", "Covington"),
    ],
    "OH-DC-01": [
        ("Buckeye Steel Fabricators", "Manufacturing", "Enterprise", "Columbus"),
        ("Lake Erie Seafood Co", "Food Processing", "Mid-Market", "Cleveland"),
        ("Queen City Hospitality", "Hospitality", "Mid-Market", "Cincinnati"),
        ("Maumee Valley Plastics", "Manufacturing", "Small Business", "Toledo"),
        ("Dayton Aero Services", "Aerospace", "Enterprise", "Dayton"),
    ],
    "TN-DC-01": [
        ("Music City Builders", "Construction", "Enterprise", "Nashville"),
        ("Smoky Mountain Lodges", "Hospitality", "Mid-Market", "Gatlinburg"),
        ("Memphis Freight Hub", "Logistics", "Enterprise", "Memphis"),
        ("Chattanooga Chemical", "Chemicals", "Mid-Market", "Chattanooga"),
        ("Volunteer Food Services", "Food Processing", "Small Business", "Knoxville"),
    ],
}
STATE = {"KY-DC-01": "KY", "OH-DC-01": "OH", "TN-DC-01": "TN"}
OWNERS = ["Priya Raman", "Marcus Lee", "Elena Garcia"]
FIRST = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Sam", "Jamie", "Avery", "Drew",
         "Quinn", "Reese", "Harper", "Rowan", "Skyler"]
LAST = ["Nguyen", "Patel", "Johnson", "Okafor", "Smith", "Kim", "Hernandez", "Brown", "Clark", "Davis",
        "Lopez", "Wright", "Hill", "Young", "Turner"]
TITLES = ["Procurement Manager", "Plant Manager", "Safety Director", "Operations Manager", "Purchasing Agent"]
SEGMENT_DISCOUNT = {"Enterprise": 12.0, "Mid-Market": 6.0, "Small Business": 0.0}

MONTHS = [date(2026 + (6 + i) // 12, (6 + i) % 12 + 1, 1) for i in range(12)]  # Jul 2026 .. Jun 2027
SEASON = {7: 1.00, 8: 1.04, 9: 1.02, 10: 1.05, 11: 0.96, 12: 0.85, 1: 0.92, 2: 0.95, 3: 1.02, 4: 1.04, 5: 1.06, 6: 1.03}


def q(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def rows(table, cols, data, conflict):
    out = [f"insert into crm.{table} ({', '.join(cols)}) values"]
    out.append(",\n".join("  (" + ", ".join(q(v) for v in r) + ")" for r in data))
    out.append(f"on conflict ({conflict}) do nothing;\n")
    return "\n".join(out)


def main():
    price = {s: round(c * MARKUP[cat], 2) for s, (n, cat, c) in PRODUCTS.items()}
    sql = ["-- Generated by db/seed/generate_seed.py. Synthetic data. Safe to run again.",
           "begin;\n",
           rows("price_list", ["sku", "product_name", "category", "list_price"],
                [(s, n, cat, price[s]) for s, (n, cat, c) in PRODUCTS.items()], "sku")]

    accounts, contacts, opps, acts, forecasts, budgets = [], [], [], [], [], []
    n_acc, n_con, n_opp, n_act = 1001, 2001, 3001, 4001
    buys = {}  # account_id -> {sku: share}
    for dc, names in ACCOUNTS.items():
        ids = []
        for i, (name, industry, segment, city) in enumerate(names):
            aid = f"ACC-{n_acc}"; n_acc += 1
            ids.append(aid)
            buys[aid] = {}
            accounts.append((aid, name, industry, segment, "Active", OWNERS[(n_acc + i) % 3], city, STATE[dc], dc,
                             SEGMENT_DISCOUNT[segment], f"(555) 01{n_acc % 100:02d}-{1000 + n_acc}",
                             "https://" + name.lower().replace(" ", "") + ".example"))
        # Each SKU this DC sells goes to two of its accounts, split 60/40.
        for k, sku in enumerate(sorted(ERP_AVG_MONTH[dc])):
            a, b = ids[k % 5], ids[(k + 2) % 5]
            buys[a][sku] = 0.6
            buys[b][sku] = 0.4
        for aid in ids:
            acc = next(x for x in accounts if x[0] == aid)
            disc = acc[9]
            for c in range(2):
                f, l = rng.choice(FIRST), rng.choice(LAST)
                domain = acc[11].removeprefix("https://")
                contacts.append((f"CON-{n_con}", aid, f, l, TITLES[(n_con + c) % len(TITLES)],
                                 f"{f.lower()}.{l.lower()}@{domain}", f"(555) 02{n_con % 100:02d}-{n_con}", c == 0))
                n_con += 1
            # Budget and forecast per SKU and month.
            for sku, share in sorted(buys[aid].items()):
                base = ERP_AVG_MONTH[dc][sku] * share
                unit = round(price[sku] * (1 - disc / 100), 2)
                drift = rng.uniform(0.9, 1.12)  # customer is systematically over/under the budget
                for m in MONTHS:
                    bq = max(1, round(base * 1.05 * SEASON[m.month]))
                    budgets.append(("FY2027 Original", aid, sku, m.isoformat(), bq, round(bq * unit, 2)))
                    fq = max(0, round(bq * drift * rng.uniform(0.9, 1.1)))
                    src = "Customer" if rng.random() < 0.6 else "Sales rep"
                    forecasts.append((aid, sku, m.isoformat(), fq, unit, src))
            # Pipeline
            stages = [("Proposal", 50), ("Negotiation", 75), ("Qualification", 25), ("Closed Won", 100),
                      ("Prospecting", 10), ("Closed Lost", 0)]
            for j in range(rng.choice([1, 2])):
                st, pr = stages[(n_opp + j) % len(stages)]
                sku = rng.choice(sorted(buys[aid])) if buys[aid] else "UFS-1001"
                amt = round(rng.randint(8, 40) * 500.0, 2)
                close = date(2026, rng.choice([9, 10, 11, 12]), rng.randint(1, 28)) if st.startswith("Closed") \
                    else date(2027, rng.choice([1, 2, 3]), rng.randint(1, 28)) if st in ("Prospecting", "Qualification") \
                    else date(2026, rng.choice([11, 12]), rng.randint(1, 28))
                opps.append((f"OPP-{n_opp}", aid, f"{PRODUCTS[sku][0]} program {2027 if close.year == 2027 else 2026}",
                             st, amt, pr, close.isoformat(), acc[5],
                             None if st.startswith("Closed") else rng.choice(["Send revised quote", "Site visit", "Sample fitting", "Contract review"])))
                n_opp += 1
            for kind, subj, due, done in [("Call", "Quarterly demand review", date(2026, 10, rng.randint(1, 25)), True),
                                          ("Meeting", "FY2027 volume planning", date(2026, 11, rng.randint(2, 27)), False)]:
                acts.append((f"ACT-{n_act}", aid, None, None, kind, subj, due.isoformat(), done, None))
                n_act += 1

    sql.append(rows("accounts", ["account_id", "account_name", "industry", "segment", "account_status", "account_owner",
                                 "billing_city", "billing_state", "home_warehouse_id", "discount_pct", "phone", "website"],
                    accounts, "account_id"))
    sql.append(rows("contacts", ["contact_id", "account_id", "first_name", "last_name", "title", "email", "phone", "is_primary"],
                    contacts, "contact_id"))
    sql.append(rows("opportunities", ["opportunity_id", "account_id", "opportunity_name", "stage", "amount",
                                      "probability_pct", "close_date", "owner", "next_step"], opps, "opportunity_id"))
    sql.append(rows("activities", ["activity_id", "account_id", "contact_id", "opportunity_id", "activity_type",
                                   "subject", "due_date", "is_done", "notes"], acts, "activity_id"))
    sql.append(rows("budget_versions", ["budget_version", "fiscal_year", "version_status", "description"],
                    [("FY2027 Original", 2027, "Approved", "Original sales budget, Jul 2026 - Jun 2027")], "budget_version"))
    sql.append(rows("sales_budgets", ["budget_version", "account_id", "sku", "budget_month", "budget_qty", "budget_amount"],
                    budgets, "budget_version, account_id, sku, budget_month"))
    sql.append(rows("demand_forecasts", ["account_id", "sku", "forecast_month", "forecast_qty", "unit_price", "forecast_source"],
                    forecasts, "account_id, sku, forecast_month"))
    sql.append("""-- Move the ID sequences past the seeded IDs so the app's new records don't collide.
select setval('crm.account_seq',     greatest((select max(substr(account_id, 5)::int)     from crm.accounts), 1000));
select setval('crm.contact_seq',     greatest((select max(substr(contact_id, 5)::int)     from crm.contacts), 2000));
select setval('crm.opportunity_seq', greatest((select max(substr(opportunity_id, 5)::int) from crm.opportunities), 3000));
select setval('crm.activity_seq',    greatest((select max(substr(activity_id, 5)::int)    from crm.activities), 4000));

commit;""")
    print("\n".join(sql))


if __name__ == "__main__":
    main()
