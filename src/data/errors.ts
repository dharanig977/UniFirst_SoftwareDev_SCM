// Turns a Supabase/PostgREST error into a message a person can act on.
import type { PostgrestError } from '@supabase/supabase-js'

export class DataError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'DataError'
    this.code = code
  }
}

export function toDataError(error: PostgrestError | null, action: string): DataError {
  if (!error) return new DataError(`${action} failed for an unknown reason.`)
  const code = error.code
  // The write functions raise messages like "OVER_RECEIPT: ..." on purpose.
  if (code === 'P0001' || code === '22023') return new DataError(error.message, code)
  if (code === '42501') {
    return new DataError(`${action}: permission denied. Sign in with an account that has the right ERP role.`, code)
  }
  if (code === 'PGRST106' || /schema must be one of/i.test(error.message)) {
    return new DataError(`${action}: the "api" schema is not exposed. Add it under Supabase Dashboard > Project Settings > Data API > Exposed schemas.`, code)
  }
  if (code === '23505') return new DataError(`${action}: that ID already exists (duplicate primary key).`, code)
  if (code === '23503') return new DataError(`${action}: a referenced supplier, product or purchase order does not exist.`, code)
  return new DataError(`${action} failed: ${error.message}`, code)
}
