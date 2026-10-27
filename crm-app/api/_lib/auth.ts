// Who is calling? The CRM uses the same sign-in as the ERP (Supabase Auth on
// the ERP project), so one account works in both apps. The browser sends its
// Supabase access token; we ask Supabase to confirm it and read the role.
import type { ServerConfig } from './config.js'

export type Role = 'viewer' | 'operator'

export interface CrmUser {
  id: string
  email: string
  role: Role | null
  token: string
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** An optional crm_role overrides erp_role, so CRM access can differ from ERP access later. */
export function roleFrom(appMetadata: Record<string, unknown> | undefined): Role | null {
  const r = appMetadata?.crm_role ?? appMetadata?.erp_role
  return r === 'viewer' || r === 'operator' ? r : null
}

const cache = new Map<string, { user: CrmUser; until: number }>()

export async function verifyUser(cfg: ServerConfig, authHeader: string | null): Promise<CrmUser> {
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) throw new HttpError(401, 'Not signed in.')
  const hit = cache.get(token)
  if (hit && hit.until > Date.now()) return hit.user
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, { headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${token}` } })
  if (res.status === 401 || res.status === 403) throw new HttpError(401, 'Your session has expired. Sign in again.')
  if (!res.ok) throw new HttpError(502, `Could not check your sign-in with Supabase (HTTP ${res.status}).`)
  const body = (await res.json()) as { id: string; email?: string; app_metadata?: Record<string, unknown> }
  const user: CrmUser = { id: body.id, email: body.email ?? '', role: roleFrom(body.app_metadata), token }
  if (cache.size > 500) cache.clear()
  cache.set(token, { user, until: Date.now() + 60_000 })
  return user
}

export function requireRead(u: CrmUser) {
  if (!u.role) throw new HttpError(403, 'Your account has no CRM role yet. An administrator must set erp_role (or crm_role) to "viewer" or "operator".')
}

export function requireWrite(u: CrmUser) {
  requireRead(u)
  if (u.role !== 'operator') throw new HttpError(403, 'Only operators can change CRM data. Your role is viewer.')
}
