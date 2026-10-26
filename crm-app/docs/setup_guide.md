# CRM setup guide (online only, about 30 minutes)

You need: your GitHub account (already connected), a free Aiven account, and Vercel (already used for the ERP). Nothing is installed on your computer.

## 1. Create the free database on Aiven

1. Go to [console.aiven.io](https://console.aiven.io) and sign up (no credit card needed).
2. **Create service → PostgreSQL → Free plan.** Pick a region close to Vercel's (for example a US East region). Name it `unifirst-crm`.
3. Wait until the status is **Running** (2 to 5 minutes).
4. On the service **Overview** page, find **Connection information**. You will copy two things from here in step 2:
   - **Service URI** (starts with `postgres://avnadmin:…`). This is the admin login.
   - **CA certificate**: click *Show* / *Download*. It starts with `-----BEGIN CERTIFICATE-----`.

> The free plan allows 20 connections. The app uses at most 2 per server instance, and the warehouse ETL at most 3.

## 2. Add four secrets to GitHub

GitHub repository → **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Name | Value |
|---|---|
| `CRM_ADMIN_DATABASE_URL` | the Aiven **Service URI** |
| `CRM_DATABASE_CA` | the whole **CA certificate** text, including the BEGIN and END lines |
| `CRM_APP_PASSWORD` | a new password you make up for the app login. **Use only letters and digits**, 20+ characters |
| `CRM_ETL_PASSWORD` | another new password for the warehouse ETL login, letters and digits only |

Never paste these into chat, code or a document.

## 3. Create the tables and sample data (GitHub Actions)

1. GitHub → **Actions → CRM database → Run workflow**, choose **action = setup**, then **Run workflow**.
2. Open the run when it finishes. The last step should show the row counts (15 accounts, 30 contacts, 576 forecasts, 576 budget lines, 0 orders) and four lines ending in `ok`.
3. Running **setup** again is safe: it only adds what is missing and never deletes or overwrites rows.

## 4. Deploy the app on Vercel (a second Vercel project)

1. [vercel.com](https://vercel.com) → **Add New → Project** → import the same repository again.
2. Set **Root Directory** to `crm-app` (click *Edit* next to it). Vercel detects Vite.
3. **Environment Variables:**

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | the same value as in the ERP project |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the same value as in the ERP project (publishable key only) |
| `CRM_DATABASE_URL` | the Service URI with the user and password swapped: `postgres://crm_app:<CRM_APP_PASSWORD>@<host>:<port>/defaultdb` (copy host and port from the Service URI; leave out `?sslmode=require`) |
| `CRM_DATABASE_CA` | the same CA certificate text as the GitHub secret |

4. **Deploy**, then open the URL.

## 5. First use

1. Sign in with your ERP email and password. (Your `erp_role = operator` gives you full CRM access.)
2. Open **ERP Orders → Link ERP sales orders → Auto-link all**. Each ERP sales order gets the customer at the same warehouse that plans to buy that SKU, at that customer's net price. Draft orders are skipped, and so is the ERP test order in `TEST-01`.
3. Open **Reports → Demand vs Actual vs Budget.** You should see Demand, Budget and Actual for July to October 2026.

New ERP sales orders appear unlinked until someone clicks **Auto-link all** again (or links them one by one).

## 6. Give the warehouse ETL its read-only login

The ETL connects as `crm_etl_reader` with the `CRM_ETL_PASSWORD` you chose:

```
postgres://crm_etl_reader:<CRM_ETL_PASSWORD>@<host>:<port>/defaultdb?sslmode=verify-full
```

plus the same CA certificate. Store it as a secret in the scheduler the warehouse uses, never in code.

## If something goes wrong

| You see | Do this |
|---|---|
| "Server setup: missing environment variable(s) …" | Add the named variable in Vercel → Settings → Environment Variables, then **Redeploy**. |
| "CRM_DATABASE_CA is not set" | Add the CA certificate to Vercel (step 4). |
| "Your account has no CRM role yet" | Your Supabase user needs `erp_role` (or `crm_role`) set to `viewer` or `operator`. |
| "The CRM server hit an unexpected error" | Vercel → the CRM project → **Logs** shows the real error (wrong password, Aiven service powered off, …). |
| Workflow fails at "Check the secrets are set" | One of the four secrets in step 2 is missing or misspelled. |
| Aiven service shows **Powered off** | Free services are powered off after long inactivity. Click **Power on** in Aiven. |
