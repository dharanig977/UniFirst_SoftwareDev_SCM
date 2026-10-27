// A small form builder used for accounts, contacts, opportunities and
// activities. Checks required fields in the browser; the server validates
// everything again.
import { useState, type FormEvent } from 'react'
import { useSubmit } from '../shell/useSubmit'
import { FastTab } from '../shell/Page'
import { Field } from './Field'
import { Notice } from './Notice'

export interface FieldDef {
  name: string
  label: string
  type?: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'email' | 'url' | 'textarea'
  options?: readonly (string | { value: string; label: string })[]
  required?: boolean
  hint?: string
  min?: number
  max?: number
  step?: string
}

export type Values = Record<string, string | boolean>

/** Turns a record into form values (numbers become strings, null becomes ''). */
export function toValues(fields: FieldDef[], rec: Record<string, unknown> | null | undefined): Values {
  const v: Values = {}
  for (const f of fields) {
    const x = rec?.[f.name]
    v[f.name] = f.type === 'checkbox' ? x === true : x === null || x === undefined ? '' : String(x)
  }
  return v
}

/** Turns form values into the request body (numbers parsed, blanks as null). */
export function fromValues(fields: FieldDef[], v: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const x = v[f.name]
    if (f.type === 'checkbox') out[f.name] = x === true
    else if (typeof x === 'string' && x.trim() === '') out[f.name] = null
    else out[f.name] = f.type === 'number' ? Number(x) : x
  }
  return out
}

export function RecordForm({
  title = 'General',
  fields,
  initial,
  disabled,
  onSave,
  saveLabel = 'Save',
  resetAfterSave,
  onCancel,
}: {
  title?: string
  fields: FieldDef[]
  initial: Values
  disabled?: boolean
  onSave: (body: Record<string, unknown>) => Promise<string>
  saveLabel?: string
  resetAfterSave?: boolean
  onCancel?: () => void
}) {
  const [values, setValues] = useState<Values>(initial)
  const [touched, setTouched] = useState(false)
  const submit = useSubmit()
  const errors: Record<string, string> = {}
  for (const f of fields) {
    const x = values[f.name]
    if (f.required && typeof x === 'string' && !x.trim()) errors[f.name] = `${f.label} is required.`
    if (f.type === 'number' && typeof x === 'string' && x.trim() !== '') {
      const n = Number(x)
      if (!Number.isFinite(n)) errors[f.name] = 'Enter a number.'
      else if (f.min !== undefined && n < f.min) errors[f.name] = `Must be at least ${f.min}.`
      else if (f.max !== undefined && n > f.max) errors[f.name] = `Must be at most ${f.max}.`
    }
  }
  const shown = touched ? errors : {}
  const off = disabled || submit.saving

  const save = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (Object.keys(errors).length) return
    void submit.run(async () => {
      const msg = await onSave(fromValues(fields, values))
      if (resetAfterSave) {
        setValues(initial)
        setTouched(false)
      }
      return msg
    })
  }
  const set = (name: string, v: string | boolean) => setValues({ ...values, [name]: v })

  return (
    <form onSubmit={save} noValidate>
      <FastTab title={title}>
        <div className="form-grid">
          {fields.map((f) => (
            <Field key={f.name} label={f.label + (f.required ? ' *' : '')} error={shown[f.name]} hint={f.hint}>
              {f.type === 'select' ? (
                <select value={values[f.name] as string} onChange={(e) => set(f.name, e.target.value)} disabled={off}>
                  {!f.required && <option value="">—</option>}
                  {f.required && !values[f.name] && <option value="">Choose…</option>}
                  {f.options!.map((o) => {
                    const opt = typeof o === 'string' ? { value: o, label: o } : o
                    return (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    )
                  })}
                </select>
              ) : f.type === 'checkbox' ? (
                <input type="checkbox" checked={values[f.name] === true} onChange={(e) => set(f.name, e.target.checked)} disabled={off} />
              ) : f.type === 'textarea' ? (
                <textarea rows={3} value={values[f.name] as string} onChange={(e) => set(f.name, e.target.value)} disabled={off} />
              ) : (
                <input type={f.type ?? 'text'} min={f.min} max={f.max} step={f.step} value={values[f.name] as string} onChange={(e) => set(f.name, e.target.value)} disabled={off} />
              )}
            </Field>
          ))}
        </div>
      </FastTab>
      <div className="form-footer">
        <button type="submit" className="primary" disabled={off}>
          {submit.saving ? 'Saving…' : saveLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={submit.saving}>
            Cancel
          </button>
        )}
      </div>
      {submit.result && (
        <Notice kind={submit.result.kind} onClose={() => submit.setResult(null)}>
          {submit.result.text}
        </Notice>
      )}
    </form>
  )
}
