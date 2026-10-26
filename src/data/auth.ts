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

/** The ERP role an administrator set in the user's app_metadata ("viewer" or "operator"). */
export function erpRole(session: Session | null): string | null {
  const role = session?.user?.app_metadata?.erp_role
  return typeof role === 'string' ? role : null
}

/** A friendly name for the welcome screen: the user's display name if set, else their email name. */
export function displayName(session: Session | null): string {
  const meta = session?.user?.user_metadata ?? {}
  const name = meta.full_name ?? meta.display_name ?? meta.name
  if (typeof name === 'string' && name.trim()) return name.trim()
  const local = session?.user?.email?.split('@')[0] ?? 'there'
  return local.charAt(0).toUpperCase() + local.slice(1)
}
