# Local dry run

Tests `../migrations/001_erp_app_api.sql` against an in-memory Postgres (PGlite)
that mirrors the verified Supabase schema and data. It never touches Supabase.

    npm install --no-save @electric-sql/pglite
    node supabase/dryrun/run.mjs supabase/dryrun/replica.sql supabase/migrations/001_erp_app_api.sql
