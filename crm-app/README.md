# UniFirst CRM

A Salesforce-style CRM for the UniFirst supply-chain project. It keeps the customer side that the ERP doesn't have (customers, contacts, pipeline, **customer demand forecasts**, the **sales budget**, and **which customer each ERP sales order belongs to, at what price**) so the warehouse and Power BI can report **Demand vs Actual vs Budget** by customer × product × month.

| Module | Pages |
|---|---|
| Customers | Accounts (list, record page with contacts, opportunities, activities and ERP orders), New account, Contacts, Activities |
| Opportunities | Pipeline board by stage (or list), New opportunity, one-click stage moves |
| Demand & Budget | Demand forecast grid and Sales budget grid (account × SKU × 12 months, with ERP actuals under each line), budget versions (copy, approve, lock), Price list |
| ERP Orders | Link ERP sales orders to customers: **Auto-link all**, or link/change/unlink one order |
| Reports | Demand vs Actual vs Budget (by month, customer, SKU or warehouse; units or USD; variances; forecast accuracy; CSV), Pipeline report |

Same look and stack as the ERP app: React + TypeScript + Vite, deployed on Vercel. Sign-in uses the **ERP's Supabase Auth**, so the same account works in both apps.

## How it fits together

```
Browser (Vercel)                       Vercel Function  /api/crm             Aiven PostgreSQL (free)
  React app  ── Supabase token ──▶    checks the token with Supabase   ──▶   schema crm  (login: crm_app)
     │                                 checks erp_role / crm_role
     └─ reads ERP sales orders (read only, ERP's own API and rules)
                                                                              ▲
                                       Warehouse ETL (other thread) ──────────┘ login: crm_etl_reader (read only)
```

- **The database password never reaches the browser.** Only the Vercel Function knows `CRM_DATABASE_URL`, and it connects with full TLS verification using Aiven's CA certificate.
- **Roles:** reads need `erp_role` (or an optional `crm_role`) of `viewer` or `operator` in the user's Supabase `app_metadata`; changes need `operator`. The server enforces this; the screens only mirror it.
- **The ERP is never changed.** ERP sales orders have no customer or price, so the CRM table `crm.orders` holds that link instead.
- **Warehouse-friendly tables:** every table has a business-key primary key, `created_at`, `updated_at` (kept by a trigger) and soft delete (`is_deleted`, `deleted_at`). The app login has no DELETE right at all.

## Folder map

```
api/crm.ts               the only server endpoint (/api/crm?r=…), a Vercel Function
api/_lib/                config, database pool, sign-in check, ERP reader, validation, handlers
src/                     the React app (same shell and components as the ERP)
src/lib/plan.ts          Demand / Budget / Actual maths (tested in plan.test.ts)
db/001_crm_schema.sql    tables, triggers, indexes (safe to re-run)
db/002_crm_roles.sql     crm_app and crm_etl_reader logins (safe to re-run)
db/seed/                 sample data generator and its output (safe to re-run, never overwrites)
tests/api.test.ts        API tests against a real local PostgreSQL
docs/setup_guide.md      step-by-step setup, online only
```

## Set it up

Follow [docs/setup_guide.md](docs/setup_guide.md). It is all done in the browser: Aiven, GitHub and Vercel.

## Run on your own computer (optional)

Node 22+ and a local PostgreSQL:

```bash
npm install
npx tsc -b
TEST_DATABASE_URL=postgres://postgres@localhost:5432/crm_test npm test
npm run build
```
