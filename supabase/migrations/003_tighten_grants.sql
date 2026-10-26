-- =====================================================================
-- 003_tighten_grants.sql  (REMOVES EXTRA PERMISSIONS ONLY: no data, table,
-- policy or function is changed or dropped)
--
-- Why: after 001 was applied, broad grants appeared on the `raw` tables
-- and `api` views (INSERT/UPDATE/DELETE for anon and authenticated), most
-- likely from the dashboard step that exposed the `api` schema. RLS still
-- blocks every write (verified 2026-10-26), but the design is two layers:
-- table grants AND RLS. This puts the grants back to what 001 intended:
--   anon          -> nothing
--   authenticated -> SELECT only; writes only through the api functions
-- service_role is left as Supabase sets it (server-side admin key, never
-- used in the browser).
-- =====================================================================

-- Raw tables: read-only for signed-in users, nothing for anonymous.
revoke insert, update, delete, truncate, references, trigger on all tables in schema raw from anon, authenticated;
revoke all on all tables in schema raw from anon;

-- api views: same.
revoke insert, update, delete, truncate, references, trigger on all tables in schema api from anon, authenticated;
revoke all on all tables in schema api from anon;

-- Write functions from 001: signed-in only (002's functions already are).
revoke execute on function api.create_purchase_order(text, text, text, integer, date) from anon;
revoke execute on function api.record_goods_receipt(text, integer, date) from anon;
revoke execute on function api.current_erp_role() from anon, public;
