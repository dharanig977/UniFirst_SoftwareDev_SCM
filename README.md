# Supply Chain ERP

A small ERP-style operations app on top of an existing Supabase (PostgreSQL) database of synthetic supply-chain data.

- **Operations:** search purchase orders, create a PO from existing suppliers and products, and record goods receipts. Over-receipts are flagged and blocked.
- **Inventory & Analytics:** inventory by SKU and warehouse from `reporting.vw_inventory_reconciliation`, an independent recheck of each row, open and overdue POs, and a discrepancy investigation panel with recommendations.

Stack: React + TypeScript + Vite, `@supabase/supabase-js`, Supabase Auth, Row Level Security, and Postgres functions.

## How it is put together

```
src/lib/supabaseClient.ts   the only place the Supabase client is created (refuses secret keys)
src/data/*.ts               one data-access file per area: products, suppliers,
                            purchaseOrders, goodsReceipts, reporting, auth
src/lib/logic.ts            pure business rules: PO status, validation, reconciliation, investigation
src/screens/                Operations, Inventory & Analytics, Login
supabase/migrations/        SQL applied to the database (additive only)
supabase/dryrun/            local Postgres dry run of the migration (32 checks)
docs/                       schema findings and the write-testing plan
```

**Security model.** The browser uses only the publishable key. The `raw` and `reporting` schemas are not exposed; the app talks to a separate `api` schema.
- Signed-in users whose admin-set `app_metadata.erp_role` is `viewer` or `operator` can read.
- Only operators can write, and only through `api.create_purchase_order` and `api.record_goods_receipt`. These functions validate input, generate IDs under a lock, and reject over-receipts.
- There are no direct INSERT/UPDATE grants, and RLS stays enabled on every table.

**Operational vs reporting data.** A goods receipt records what arrived. It never changes the inventory snapshot. Instead, the reporting view calculates `adjusted_on_hand = snapshot + receipts after the snapshot day`.

## Deploy online (no installs): Vercel

1. Sign in to [vercel.com](https://vercel.com) with GitHub.
2. **Add New → Project**, then import this repository. Vercel detects Vite automatically.
3. Add two **Environment Variables**:
   - `VITE_SUPABASE_URL` = `https://<your-project-ref>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = your `sb_publishable_...` key (Supabase → Project Settings → API Keys). **Never the secret / service_role key.**
4. Click **Deploy**, then open the URL Vercel gives you.

Supabase settings the app needs (one time):
- Project Settings → Data API → Exposed schemas → add `api`.
- Authentication → Users → Add user (tick Auto Confirm). Then set the role:
  ```sql
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"erp_role":"operator"}'
  where email = 'you@example.com';
  ```
- Recommended: turn off public sign-ups.

## Run on your own computer (optional)

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local   # then fill in the two values
npm run dev                  # http://localhost:5173
npm test                     # business-rule tests
npm run build                # production build into dist/
```
