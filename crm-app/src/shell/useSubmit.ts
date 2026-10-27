import { useRef, useState } from 'react'

export type Result = { kind: 'success' | 'error'; text: string } | null

/**
 * Runs a save action once at a time. The ref updates instantly, so a fast
 * double-click can't send the same form twice (React state only updates on
 * the next render).
 */
export function useSubmit() {
  const inFlight = useRef(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<Result>(null)

  async function run(action: () => Promise<string>) {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setResult(null)
    try {
      setResult({ kind: 'success', text: await action() })
    } catch (err) {
      setResult({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return { saving, result, setResult, run }
}
