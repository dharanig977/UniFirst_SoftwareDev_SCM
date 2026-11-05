# AI agents for sales orders

Two Claude-powered agents plus database rules that check stock, deduct bins and send e-mail.

| Piece | Where it runs | What it does |
|---|---|---|
| **Sales order agent** | Edge Function `sales-order-agent` | Reads a plain-English request ("Derby City Foods wants 10 Chef Coats"), looks up the customer, SKU, price and stock with tools, then creates a Draft order through `api.agent_create_sales_order`. |
| **Approver agent** | Edge Function `approver-agent` | Runs `api.auto_review_sales_order`. Fixed rules decide: stock available **and** amount ≤ $1,000 → Approved (order goes Open); otherwise → Needs Approval for a person. Claude only writes a short explanation; it cannot change the decision. |
| **Automatic stock check** | `api.check_stock`, view `api.sales_order_stock` | Available = qty in bins − open qty of other confirmed orders. Shown as Available / Partial / Short on every open order. |
| **Ship + shortage alert** | `api.ship_sales_order` | Deducts from the fullest bin first, writes `ops.stock_movements`, updates shipped qty/status. If units could not be picked, or total left is below the reorder point, it queues an e-mail to the inventory team with every bin's qty. |
| **Weekly sales report** | pg_cron `erp-weekly-sales-report` (Mon 13:00 UTC = 08:00 Eastern in winter) | Counts last week's orders and lists the ones above $1,000 with amounts, for the sales head. |
| **E-mail sender** | Edge Function `send-notifications`, pg_cron `erp-send-notifications` (every 5 min) | Sends queued e-mails through Resend. |

Database objects: `supabase/migrations/004_sales_agents.sql` and `005_agent_email_schedule.sql` (both applied to the ERP project on 2026-11-05). Existing `raw` tables were not altered; new data lives in schema `ops`.

Prices: copied from the CRM price list (`ops.price_list`) less the customer's discount. Older orders without an agent record use qty × list price in the weekly report.

Bins: seeded from the latest reconciliation row per SKU and warehouse, split 60/40 into an A bin and a B bin, reorder point 10 per bin.

## One-time setup (Supabase dashboard)

1. **Claude API key**: create one at console.anthropic.com → API keys. In Supabase → Edge Functions → Secrets, add `ANTHROPIC_API_KEY`.
2. **Resend key**: sign up at resend.com (free), create an API key, add it as `RESEND_API_KEY` in the same place. Without a verified domain, Resend only delivers to the e-mail you signed up with, sent from `onboarding@resend.dev`.
3. **Recipients**: in the SQL editor run (use the address you signed up to Resend with until a domain is verified):

   ```sql
   update ops.settings set value = 'you@example.com' where key in ('sales_head_email', 'inventory_team_email');
   ```

   Limits can be changed the same way (`auto_approve_limit`, `weekly_report_min`).

## Try it in the app

AI Agents → **Sales order agent** → type a request. Then **Approvals** (approve the big ones), **Ship orders** (ship and watch bins drop), **E-mail outbox** (preview, "Queue weekly report now", "Send queued now").

The model is `claude-opus-5-5` with server-side refusal fallbacks enabled (`fallbacks: "default"`).
