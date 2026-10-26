import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Notice } from './components/Notice'
import { erpRole, getSession, onAuthChange, signOut } from './data/auth'
import { configProblem } from './lib/supabaseClient'
import { InventoryScreen } from './screens/InventoryScreen'
import { LoginScreen } from './screens/LoginScreen'
import { OperationsScreen } from './screens/OperationsScreen'

type Tab = 'operations' | 'inventory'

export default function App() {
  const problem = configProblem()
  if (problem) {
    return (
      <div className="center">
        <div className="card login">
          <h1>Setup needed</h1>
          <Notice kind="error">{problem}</Notice>
        </div>
      </div>
    )
  }
  return <AuthedApp />
}

function AuthedApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [tab, setTab] = useState<Tab>('operations')
  // Bumped after every successful write so both screens re-read the database.
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    void getSession().then(setSession)
    return onAuthChange(setSession)
  }, [])

  if (session === undefined) return <div className="center"><Notice kind="loading">Checking sign-in…</Notice></div>
  if (!session) return <LoginScreen />

  const role = erpRole(session)
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Supply Chain ERP</div>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'operations'} className={tab === 'operations' ? 'active' : ''} onClick={() => setTab('operations')}>
            Operations
          </button>
          <button role="tab" aria-selected={tab === 'inventory'} className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>
            Inventory &amp; Analytics
          </button>
        </nav>
        <div className="user">
          <span className="muted small">
            {session.user.email} · {role ?? 'no ERP role'}
          </span>
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main>
        {!role && (
          <Notice kind="warning">
            Your account has no ERP role yet, so the database will return no data. An administrator must set <code>erp_role</code> to "viewer" or
            "operator" in your Supabase user's app_metadata.
          </Notice>
        )}
        {tab === 'operations' ? (
          <OperationsScreen canWrite={role === 'operator'} refreshKey={refreshKey} onDataChanged={() => setRefreshKey((k) => k + 1)} />
        ) : (
          <InventoryScreen refreshKey={refreshKey} />
        )}
      </main>
    </div>
  )
}
