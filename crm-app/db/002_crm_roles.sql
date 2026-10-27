-- =============================================================================
-- 002_crm_roles.sql  -  least-privilege logins for the CRM database
--
-- Run after 001 with psql, passing the two passwords as variables (the GitHub
-- workflow "CRM database" does this from repository secrets):
--   psql "$CRM_ADMIN_URL" -v app_password=... -v etl_password=... -f 002_crm_roles.sql
--
--   crm_app         the web app's API. Read + insert + update on crm.*,
--                   no DELETE (the app soft-deletes), no DDL.
--   crm_etl_reader  the warehouse ETL. Read-only, every session read-only.
-- Safe to run again: it re-applies grants and resets both passwords.
-- =============================================================================
\set ON_ERROR_STOP on

select format('create role crm_app login password %L', :'app_password')
where not exists (select 1 from pg_roles where rolname = 'crm_app') \gexec
select format('create role crm_etl_reader login password %L', :'etl_password')
where not exists (select 1 from pg_roles where rolname = 'crm_etl_reader') \gexec

select format('alter role crm_app password %L', :'app_password') \gexec
select format('alter role crm_etl_reader password %L', :'etl_password') \gexec

-- Aiven's free plan allows 20 connections in total; keep headroom for admin.
alter role crm_app connection limit 10;
alter role crm_etl_reader connection limit 3;
alter role crm_etl_reader set default_transaction_read_only = on;
alter role crm_app set statement_timeout = '15s';
alter role crm_etl_reader set statement_timeout = '60s';

grant usage on schema crm to crm_app, crm_etl_reader;

grant select, insert, update on all tables in schema crm to crm_app;
revoke delete, truncate on all tables in schema crm from crm_app;
grant usage, select on all sequences in schema crm to crm_app;

grant select on all tables in schema crm to crm_etl_reader;

-- Tables added later by the same admin get the same rights automatically.
alter default privileges in schema crm grant select, insert, update on tables to crm_app;
alter default privileges in schema crm grant usage, select on sequences to crm_app;
alter default privileges in schema crm grant select on tables to crm_etl_reader;
