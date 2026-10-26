import type { Session } from '@supabase/supabase-js'
import { getClient } from '../lib/supabaseClient'

export async function getSession(): Promise<Session | null> {
  const { data } = await getClient().auth.getSession()
  return data.session
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const { data } = getClient().auth.onAuthStateChange((_event, session) => cb(session))
  return () => data.subscription.unsubscribe()
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await getClient().auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
}

export async function signOut(): Promise<void> {
  await getClient().auth.signOut()
}

/**
 * The CRM role an administrator set in the user's app_metadata ("viewer" or
 * "operator"). An optional crm_role overrides erp_role. The server checks
 * the same rule; this copy only decides what the screens show.
 */
export function crmRole(session: Session | null): string | null {
  const meta = session?.user?.app_metadata ?? {}
  const role = meta.crm_role ?? meta.erp_role
  return role === 'viewer' || role === 'operator' ? role : null
}

/** A friendly name for the welcome screen: the user's display name if set, else their email name. */
export function displayName(session: Session | null): string {
  const meta = session?.user?.user_metadata ?? {}
  const name = meta.full_name ?? meta.display_name ?? meta.name
  if (typeof name === 'string' && name.trim()) return name.trim()
  const local = session?.user?.email?.split('@')[0] ?? 'there'
  return local.charAt(0).toUpperCase() + local.slice(1)
}
