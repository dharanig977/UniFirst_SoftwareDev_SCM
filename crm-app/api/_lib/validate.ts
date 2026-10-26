// Server-side validation. Only fields listed here can ever reach SQL, so the
// column names used in dynamic SQL always come from this file, never from the request.
import { HttpError } from './auth.js'

type Kind = 'text' | 'int' | 'num' | 'bool' | 'date' | 'month'
interface FieldSpec {
  kind: Kind
  required?: boolean
  max?: number
  min?: number
  oneOf?: readonly string[]
  pattern?: RegExp
  upper?: boolean
  label: string
}

export const SEGMENTS = ['Enterprise', 'Mid-Market', 'Small Business'] as const
export const ACCOUNT_STATUSES = ['Prospect', 'Active', 'On Hold', 'Inactive'] as const
export const STAGES = ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'] as const
export const ACTIVITY_TYPES = ['Call', 'Meeting', 'Email', 'Task'] as const

export interface EntitySpec {
  table: string
  key: string
  fields: Record<string, FieldSpec>
}

const t = (label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ kind: 'text', max: 200, label, ...extra })

export const ENTITIES: Record<string, EntitySpec> = {
  accounts: {
    table: 'accounts',
    key: 'account_id',
    fields: {
      account_name: t('Account name', { required: true, max: 120 }),
      industry: t('Industry', { max: 60 }),
      segment: t('Segment', { required: true, oneOf: SEGMENTS }),
      account_status: t('Status', { required: true, oneOf: ACCOUNT_STATUSES }),
      account_owner: t('Owner', { max: 80 }),
      billing_city: t('City', { max: 80 }),
      billing_state: t('State', { pattern: /^[A-Z]{2}$/, upper: true }),
      home_warehouse_id: t('Serving warehouse', { max: 20, upper: true }),
      discount_pct: { kind: 'num', min: 0, max: 50, label: 'Discount %' },
      phone: t('Phone', { max: 40 }),
      website: t('Website', { max: 200, pattern: /^https?:\/\/\S+$/ }),
    },
  },
  contacts: {
    table: 'contacts',
    key: 'contact_id',
    fields: {
      account_id: t('Account', { required: true }),
      first_name: t('First name', { required: true, max: 60 }),
      last_name: t('Last name', { required: true, max: 60 }),
      title: t('Title', { max: 80 }),
      email: t('Email', { max: 200, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ }),
      phone: t('Phone', { max: 40 }),
      is_primary: { kind: 'bool', label: 'Primary contact' },
    },
  },
  opportunities: {
    table: 'opportunities',
    key: 'opportunity_id',
    fields: {
      account_id: t('Account', { required: true }),
      opportunity_name: t('Opportunity name', { required: true, max: 120 }),
      stage: t('Stage', { required: true, oneOf: STAGES }),
      amount: { kind: 'num', required: true, min: 0, max: 1e11, label: 'Amount' },
      probability_pct: { kind: 'int', required: true, min: 0, max: 100, label: 'Probability %' },
      close_date: { kind: 'date', required: true, label: 'Close date' },
      owner: t('Owner', { max: 80 }),
      next_step: t('Next step', { max: 200 }),
    },
  },
  activities: {
    table: 'activities',
    key: 'activity_id',
    fields: {
      account_id: t('Account', { required: true }),
      contact_id: t('Contact'),
      opportunity_id: t('Opportunity'),
      activity_type: t('Type', { required: true, oneOf: ACTIVITY_TYPES }),
      subject: t('Subject', { required: true, max: 200 }),
      due_date: { kind: 'date', label: 'Due date' },
      is_done: { kind: 'bool', label: 'Done' },
      notes: t('Notes', { max: 2000 }),
    },
  },
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function validDate(s: string): boolean {
  if (!DATE.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Cleans one value. Returns null for empty optional values; throws HttpError 400 with a readable message. */
export function cleanValue(spec: FieldSpec, raw: unknown): unknown {
  const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')
  if (empty) {
    if (spec.required) throw new HttpError(400, `${spec.label} is required.`)
    return spec.kind === 'bool' ? false : null
  }
  switch (spec.kind) {
    case 'text': {
      if (typeof raw !== 'string') throw new HttpError(400, `${spec.label} must be text.`)
      let s = raw.trim()
      if (spec.upper) s = s.toUpperCase()
      if (spec.max && s.length > spec.max) throw new HttpError(400, `${spec.label} is too long (max ${spec.max} characters).`)
      if (spec.oneOf && !spec.oneOf.includes(s)) throw new HttpError(400, `${spec.label} must be one of: ${spec.oneOf.join(', ')}.`)
      if (spec.pattern && !spec.pattern.test(s)) throw new HttpError(400, `${spec.label} is not in a valid format.`)
      return s
    }
    case 'int':
    case 'num': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
      if (!Number.isFinite(n)) throw new HttpError(400, `${spec.label} must be a number.`)
      if (spec.kind === 'int' && !Number.isInteger(n)) throw new HttpError(400, `${spec.label} must be a whole number.`)
      if (spec.min !== undefined && n < spec.min) throw new HttpError(400, `${spec.label} must be at least ${spec.min}.`)
      if (spec.max !== undefined && n > spec.max) throw new HttpError(400, `${spec.label} must be at most ${spec.max}.`)
      return n
    }
    case 'bool':
      if (typeof raw !== 'boolean') throw new HttpError(400, `${spec.label} must be true or false.`)
      return raw
    case 'date':
    case 'month': {
      const s = String(raw).trim()
      if (!validDate(s)) throw new HttpError(400, `${spec.label} must be a date (YYYY-MM-DD).`)
      if (spec.kind === 'month' && !s.endsWith('-01')) throw new HttpError(400, `${spec.label} must be the first day of a month.`)
      return s
    }
  }
}

/**
 * Validates a record for insert (all fields, required enforced) or update
 * (only fields present in the request).
 */
export function cleanRecord(spec: EntitySpec, data: unknown, mode: 'insert' | 'update'): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Expected a record.')
  const input = data as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [name, fs] of Object.entries(spec.fields)) {
    if (mode === 'update' && !(name in input)) continue
    out[name] = cleanValue(fs, input[name])
  }
  if (mode === 'update' && Object.keys(out).length === 0) throw new HttpError(400, 'Nothing to update.')
  return out
}

export const month = (label: string) => ({ kind: 'month' as const, required: true, label })
export const qty = (label: string) => ({ kind: 'int' as const, min: 0, max: 10_000_000, label })
export const text = t
