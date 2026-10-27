import { useState, type FormEvent } from 'react'
import { Field } from '../components/Field'
import { Notice } from '../components/Notice'
import { signIn } from '../data/auth'

export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit} noValidate>
        <div className="login-brand">
          <strong>UniFirst CRM</strong>
          <span>Customers, Demand &amp; Budget</span>
        </div>
        <h1>Sign in</h1>
        <p className="muted">Use the same account you use for the UniFirst ERP.</p>
        <Field label="Email">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <Notice kind="error">{error}</Notice>}
      </form>
    </div>
  )
}
