# Database writes: security model, SQL, and test checklist

Status as of 2026-10-26 17:47 UTC. **`001_erp_app_api.sql` has been applied to Supabase (migration `erp_app_api`), and the database-level write tests in section 4B passed.** Browser tests (4C) are still yours to run.

---

## 1. How writes work (beginner version)

Your browser app only has the **publishable key**. That key is public: anyone can find it in your website's JavaScript. So the key itself cannot be what protects your data. Two things protect it instead:

1. **Login (Supabase Auth).** A user signs in, and Supabase gives the browser a signed token that says who they are.
2. **Row Level Security (RLS) + grants.** The database checks that token on every request and decides what that person is allowed to see or do.

For writes, we don't let the browser `INSERT` into `raw.purchase_orders` or `raw.goods_receipts` directly. With direct inserts, the browser would choose the ID and the quantity, and a malicious user could skip the checks in your React code. Instead, the browser calls two **database functions**:

| Browser calls | What the database does, inside one transaction |
|---|---|
| `api.create_purchase_order(supplier, sku, warehouse, qty, expected_date)` | Checks you are an operator, the fields are present, qty is between 1 and 1,000,000, the date isn't past, and the supplier and SKU exist. Then it takes a lock, picks the next free `PO-#####`, and inserts with `order_date = today` and `status = 'Open'`. |
| `api.record_goods_receipt(po_id, qty, receipt_date)` | Checks you are an operator, qty > 0, and the date isn't in the future or before the order date. It **locks that PO row**, adds up what's already received, and **rejects** the receipt with `OVER_RECEIPT` if it's more than what remains. Otherwise it picks the next `GR-#####`, copies SKU and warehouse from the PO, inserts, and updates the PO status to `Partially Received` or `Received`. |

The functions run with the table owner's rights (`SECURITY DEFINER`), which is why they can insert while users can't. That's also why **every check lives inside the function**. The React form repeats the same checks only to give instant feedback.

**What a receipt does NOT do:** it never changes `raw.inventory_snapshots`. The snapshot is a count taken at a moment in time. The reporting view adds later receipts on top of it when you read it.

## 2. The minimum RLS policies and grants for this access model

The access model: **anonymous = nothing; signed-in "viewer" = read only; signed-in "operator" = read + the two write functions.** The role is stored in the user's `app_metadata`, which only an admin can set (a user can't promote themselves).

| Object | Grant | RLS policy | Why it's the minimum |
|---|---|---|---|
| 6 `raw` tables | `SELECT` to `authenticated` only | One `FOR SELECT` policy each: `erp_role in ('viewer','operator')` | Reading is needed for both screens. There are no INSERT/UPDATE/DELETE grants or policies, so direct writes are refused. |
| `reporting.vw_inventory_reconciliation` | `SELECT` to `authenticated` | (views can't have policies) | The `api.inventory_reconciliation` wrapper adds the same role check in its `WHERE`, because the existing view ignores RLS. |
| `api.*` read views | `SELECT` to `authenticated` | inherited (`security_invoker = true`) | The views run as the caller, so the policies above still apply. |
| 2 write functions | `EXECUTE` to `authenticated`, revoked from `anon`/`public` | role check inside: operator only | This is the only write path. |

RLS stays **enabled** on every table. No policy says `using (true)`, and nothing is granted to `anon`.

Full SQL: [`supabase/migrations/001_erp_app_api.sql`](../supabase/migrations/001_erp_app_api.sql). It only adds things (`create schema`, `create view`, `create policy`, `create function`, `grant`). It contains no `drop`, `truncate`, `delete`, `alter ... disable`, or changes to existing rows.

## 3. Configuration steps (you, in the Supabase dashboard)

These happen after the SQL is applied. I'll remind you at the right time.

1. **Expose the `api` schema:** Dashboard → Project Settings → **Data API** → *Exposed schemas* → add `api` → Save. Leave `raw` and `reporting` **unexposed**.
2. **Create your login:** Dashboard → Authentication → Users → **Add user** → *Create new user* → your email and a password → tick *Auto Confirm User*.
3. **Give that user the operator role.** I'll run this for you (it only changes your one user's metadata):
   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"erp_role":"operator"}'
   where email = 'YOUR_EMAIL_HERE';
   ```
4. (Recommended) Authentication → Sign In / Providers → turn **off** *Allow new users to sign up*, so strangers can't create accounts. They'd see no data anyway, but this is cleaner.

## 4. Test checklist

### A. Already tested: local dry run (a Postgres copy of your schema and data, not Supabase)

I rebuilt your 6 tables, keys, data, RLS settings and view in a local Postgres, applied the SQL, and ran 32 checks. **All 32 passed:**

- [x] Operator can read suppliers (2) and products (4)
- [x] Viewer reads view: UFS-1001 @ KY-DC-01 = 20 / 80 / 100 / 5 / 95
- [x] Signed-in user without an ERP role sees 0 rows (tables and view)
- [x] Anonymous visitor: reads and function calls are refused
- [x] Direct `INSERT`/`UPDATE` on raw tables is refused, even for an operator
- [x] Viewer cannot create POs or record receipts
- [x] Operator creates PO → gets `PO-10004`, status Open, warehouse normalised to upper case
- [x] Next PO gets `PO-10005` (no duplicate key)
- [x] PO rejected for qty 0, negative qty, null qty, unknown supplier, unknown SKU, past date, blank warehouse
- [x] Receipt of 6 on a 10-unit PO → `GR-50003`, SKU/warehouse copied, PO → Partially Received
- [x] Receipt of 5 when 4 remain → rejected with `OVER_RECEIPT … over-receive by 1`
- [x] Receipt of exactly 4 → accepted, PO → Received; any further receipt → rejected
- [x] Receipt rejected for unknown PO, qty 0, future date, date before order date
- [x] Inventory snapshot unchanged after receipts; original POs untouched

Plus 10 front-end unit tests of the form validation and reconciliation logic (all pass).

### B. Tested on your real Supabase database (2026-10-26, via the Supabase connector, acting as a signed-in user)

- [x] Applied `001_erp_app_api.sql` (migration `erp_app_api`); RLS still ON for all 6 tables
- [x] Security advisor: no new warnings (the only remaining one is the pre-existing `public.rls_auto_enable()` notice)
- [x] Operator reads through `api`: 2 suppliers, 4 products, 3 POs, 2 receipts
- [x] Operator reads view: UFS-1001 @ KY-DC-01 = 20 / 80 / 100 / 5 / 95
- [x] Signed-in user with no ERP role: 0 POs, 0 view rows
- [x] Anonymous: `permission denied for schema api`
- [x] Operator direct `INSERT` into `raw.purchase_orders`: `permission denied`
- [x] **Created `PO-10004`** (SUP-002, PPE-2002, TEST-01, qty 10, ordered 2026-10-26, expected 2026-10-31, Open), then **confirmed it in `raw.purchase_orders` with a separate query**
- [x] **Recorded `GR-50003`** (6 units, 2026-10-26) against PO-10004, SKU/warehouse copied from the PO, then **confirmed it in `raw.goods_receipts`**; PO-10004 status is now `Partially Received`
- [x] Receiving 5 more (4 remain) was rejected: `OVER_RECEIPT: PO-10004 has 6 of 10 received, only 4 remain open; receiving 5 would over-receive by 1`. No row was added (PO-10004 still has exactly one receipt)
- [x] PO with qty 0 was rejected: `INVALID_QTY`
- [x] Viewer recording a receipt was rejected: `NOT_ALLOWED`
- [x] Original data unchanged: PO-10001..10003 statuses, all 3 snapshots (20/5, 150/60, 35/10), UFS-1001 still 20 / 80 / 100 / 5 / 95. Totals are now 4 POs and 3 receipts.

Test data left in the database (warehouse `TEST-01`, so it's easy to spot): `PO-10004` and `GR-50003`. PO-10004 has 4 units still open, so you can try both a valid receipt and an over-receipt from the browser.

### C. You test in the browser (I can't reach Supabase from my workspace's browser)

- [ ] `npm run dev`, sign in, both screens load real data
- [ ] Create a PO with valid data → green success message with the new PO number, table refreshes
- [ ] Try qty 0 / empty fields / past date → red field errors, nothing saved
- [ ] Pick the test PO, type a quantity larger than what remains → over-receipt warning appears immediately, Save is disabled
- [ ] Record a valid receipt → success; Inventory screen refreshes
- [ ] Double-click Save quickly → only one record created
- [ ] Sign in as a "viewer" user → forms disabled, data visible

## 5. Not done yet / known limits

- **Duplicate submissions:** the browser blocks double-clicks (button disabled plus an instant in-flight lock), and the database's row lock stops two receipts from together exceeding the PO quantity. But if the **same partial receipt is sent twice on purpose** (for example from two tabs), the database will accept both, as long as the total stays within the PO. Fully preventing that needs an "idempotency key" table. That's optional, and I can add it if you want.
- **Stale existing statuses:** PO-10001 still says `Open` (80/100 received). The function only updates the status of a PO when a new receipt is recorded against it. I won't change existing rows unless you ask.
- **No cancel/edit/delete** of POs or receipts. This is deliberate for now.
- **Browser-level tests (section C)** need you, because my workspace's network can't reach `*.supabase.co`.
