// Server-side settings, read from Vercel environment variables. Nothing here
// is ever sent to the browser.

export interface ServerConfig {
  /** Postgres URL for the crm_app login on Aiven. */
  databaseUrl: string
  /** Aiven's CA certificate (PEM). Required for any non-local database. */
  databaseCa: string | null
  /** The ERP Supabase project, used only to check who is signed in and read ERP sales orders. */
  supabaseUrl: string
  supabaseKey: string
}

export class ConfigError extends Error {}

export function readConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const databaseUrl = env.CRM_DATABASE_URL?.trim()
  const supabaseUrl = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL)?.trim()
  const supabaseKey = (env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY)?.trim()
  const missing = [
    !databaseUrl && 'CRM_DATABASE_URL',
    !supabaseUrl && 'VITE_SUPABASE_URL',
    !supabaseKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
  ].filter(Boolean)
  if (missing.length) throw new ConfigError(`Server setup: missing environment variable(s) ${missing.join(', ')} in Vercel.`)
  const ca = env.CRM_DATABASE_CA?.trim() || null
  return { databaseUrl: databaseUrl!, databaseCa: ca ? ca.replace(/\\n/g, '\n') : null, supabaseUrl: supabaseUrl!.replace(/\/$/, ''), supabaseKey: supabaseKey! }
}
