import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Notice } from './components/Notice'
import { crmRole, displayName, getSession, onAuthChange } from './data/auth'
import { CrmDataProvider, useCrmData } from './data/CrmData'
import { useRoute } from './lib/router'
import { configProblem } from './lib/supabaseClient'
import { AccountPage, AccountsPage, ActivitiesPage, ContactsPage, NewAccountPage } from './pages/customers'
import { HomePage } from './pages/HomePage'
import { ModulePage } from './pages/ModulePage'
import { LinkOrdersPage } from './pages/orders'
import { BudgetPage, DemandPage, PriceListPage } from './pages/planning'
import { DabReportPage, PipelineReportPage } from './pages/reports'
import { NewOpportunityPage, PipelinePage } from './pages/sales'
import { LoginScreen } from './screens/LoginScreen'
import { AppShell } from './shell/AppShell'
import { findModule } from './shell/modules'

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
  return <AuthGate />
}

function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    void getSession().then(setSession)
    return onAuthChange(setSession)
  }, [])

  if (session === undefined) {
    return (
      <div className="center">
        <Notice kind="loading">Checking sign-in…</Notice>
      </div>
    )
  }
  if (!session) return <LoginScreen />
  return (
    <CrmDataProvider>
      <Workspace session={session} />
    </CrmDataProvider>
  )
}

function Workspace({ session }: { session: Session }) {
  const route = useRoute()
  const role = crmRole(session)
  const canWrite = role === 'operator'
  const name = displayName(session)
  const { data, loading, error, reload } = useCrmData()

  return (
    <AppShell route={route} userName={name} userEmail={session.user.email ?? ''} role={role}>
      {!role && (
        <Notice kind="warning">
          Your account has no CRM role yet, so the server returns no data. An administrator must set <code>erp_role</code> (or <code>crm_role</code>) to "viewer" or "operator" in
          your user's app_metadata.
        </Notice>
      )}
      {error && (
        <Notice kind="error">
          {error}{' '}
          <button className="link" onClick={() => void reload()}>
            Try again
          </button>
        </Notice>
      )}
      {loading && !data && <Notice kind="loading">Loading CRM data…</Notice>}
      {data && <Router route={route} name={name} canWrite={canWrite} />}
    </AppShell>
  )
}

function Router({ route, name, canWrite }: { route: string; name: string; canWrite: boolean }) {
  const p = { route, canWrite }
  if (route.startsWith('customers/accounts/')) return <AccountPage {...p} accountId={route.slice('customers/accounts/'.length)} />
  switch (route) {
    case '':
      return <HomePage userName={name} />
    case 'customers/accounts':
      return <AccountsPage {...p} />
    case 'customers/new':
      return <NewAccountPage {...p} />
    case 'customers/contacts':
      return <ContactsPage {...p} />
    case 'customers/activities':
      return <ActivitiesPage {...p} />
    case 'sales/pipeline':
      return <PipelinePage {...p} />
    case 'sales/new':
      return <NewOpportunityPage {...p} />
    case 'planning/demand':
      return <DemandPage {...p} />
    case 'planning/budget':
      return <BudgetPage {...p} />
    case 'planning/prices':
      return <PriceListPage route={route} />
    case 'orders/link':
      return <LinkOrdersPage {...p} />
    case 'reports/dab':
      return <DabReportPage route={route} />
    case 'reports/pipeline':
      return <PipelineReportPage route={route} />
  }
  const mod = findModule(route)
  if (mod) return <ModulePage module={mod} canWrite={canWrite} />
  return (
    <Notice kind="warning">
      Page not found. <a href="#/">Go to Home</a>
    </Notice>
  )
}
