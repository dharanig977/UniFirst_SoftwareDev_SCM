# Supply Chain ERP

An ERP-style supply chain operations app on top of an existing Supabase (PostgreSQL) database of synthetic supply-chain data. The layout follows enterprise ERP clients: a navigation pane, an action pane, workspaces, FastTabs and dense grids.

After sign-in you land on **Welcome, <name>** with five modules. Each module opens a workspace, and each workspace tile opens a task page:

| Module | Task pages |
|---|---|
| Purchase | New purchase order (confirm or save as draft), All purchase orders (confirm drafts), Product receipt (over-receipts blocked) |
| Sales | New sales order (shows available stock), All sales orders |
| Inventory | On-hand inventory from `reporting.vw_inventory_reconciliation`, Discrepancy investigation with recommendations |
| Master Data Management | Products, Suppliers, Warehouses, New product, New supplier |
| Reports | Purchase, sales and inventory reports with **Draft / Open / Pending / Closed** filters, vendor/warehouse/date filters and CSV export |

Order types are calculated from real quantities: Draft = saved, not confirmed; Open = confirmed, nothing received or shipped; Pending = partly received or shipped; Closed = fully received or shipped, or closed.

Stack: React + TypeScript + Vite, `@supabase/supabase-js`, Supabase Auth, Row Level Security, and Postgres functions.

## Companion apps in this repository

- **CRM**: UniFirst CRM (customers, pipeline, demand forecasts, sales budget, ERP order links) now lives in its own repository, [UniFirst_CRM](https://github.com/dharanig977/UniFirst_CRM), with its own Vercel project.
- **`analytics-warehouse/`**: the ETL and star schema behind the Power BI reports.
- **`etl-console/`**: UniFirst ETL Console, a read-only web console showing both sources (SCM, CRM), their tables, the warehouse layers, load history and data quality. Its own Vercel project with Root Directory `etl-console`. See [etl-console/README.md](etl-console/README.md).

## How it is put together

```
src/lib/supabaseClient.ts   the only place the Supabase client is created (refuses secret keys)
src/data/*.ts               one data-access file per area: products, suppliers, purchaseOrders,
                            goodsReceipts, salesOrders, masterData, reporting, auth
src/data/ErpData.tsx        loads all tables once and shares them with every page
src/lib/logic.ts            pure business rules: PO status, validation, reconciliation, investigation
src/lib/stage.ts            Draft / Open / Pending / Closed classification
src/shell/                  app frame, navigation map (modules.ts), page building blocks
src/pages/                  home, module workspaces, and the task pages for each module
supabase/migrations/        SQL applied to the database (additive only)
supabase/dryrun/            local Postgres dry runs of the migrations (001: 32 checks, 002: 24 checks)
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
