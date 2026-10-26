import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Notice } from './components/Notice'
import { displayName, erpRole, getSession, onAuthChange } from './data/auth'
import { ErpDataProvider, useErpData } from './data/ErpData'
import { useRoute } from './lib/router'
import { configProblem } from './lib/supabaseClient'
import { HomePage } from './pages/HomePage'
import { InventoryReportPage, PurchaseReportPage, SalesReportPage } from './pages/reports'
import { InvestigationPage, OnHandPage } from './pages/inventory'
import { NewProductPage, NewSupplierPage, ProductsPage, SuppliersPage, WarehousesPage } from './pages/master'
import { ModulePage } from './pages/ModulePage'
import { NewPurchaseOrderPage, ProductReceiptPage, PurchaseOrdersPage } from './pages/purchase'
import { NewSalesOrderPage, SalesOrdersPage } from './pages/sales'
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
    <ErpDataProvider>
      <Workspace session={session} />
    </ErpDataProvider>
  )
}

function Workspace({ session }: { session: Session }) {
  const route = useRoute()
  const role = erpRole(session)
  const canWrite = role === 'operator'
  const name = displayName(session)
  const { data, loading, error, reload } = useErpData()

  return (
    <AppShell route={route} userName={name} userEmail={session.user.email ?? ''} role={role}>
      {!role && (
        <Notice kind="warning">
          Your account has no ERP role yet, so the database returns no data. An administrator must set <code>erp_role</code> to "viewer" or "operator" in your
          user's app_metadata.
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
      {loading && !data && <Notice kind="loading">Loading data from Supabase…</Notice>}
      {data && <Router route={route} name={name} canWrite={canWrite} />}
    </AppShell>
  )
}

function Router({ route, name, canWrite }: { route: string; name: string; canWrite: boolean }) {
  const p = { route, canWrite }
  switch (route) {
    case '':
      return <HomePage userName={name} />
    case 'purchase/orders':
      return <PurchaseOrdersPage {...p} />
    case 'purchase/new':
      return <NewPurchaseOrderPage {...p} />
    case 'purchase/receipt':
      return <ProductReceiptPage {...p} />
    case 'sales/orders':
      return <SalesOrdersPage {...p} />
    case 'sales/new':
      return <NewSalesOrderPage {...p} />
    case 'inventory/on-hand':
      return <OnHandPage route={route} />
    case 'inventory/investigate':
      return <InvestigationPage route={route} />
    case 'master/products':
      return <ProductsPage {...p} />
    case 'master/products/new':
      return <NewProductPage {...p} />
    case 'master/suppliers':
      return <SuppliersPage {...p} />
    case 'master/suppliers/new':
      return <NewSupplierPage {...p} />
    case 'master/warehouses':
      return <WarehousesPage route={route} />
    case 'reports/purchase':
      return <PurchaseReportPage route={route} />
    case 'reports/sales':
      return <SalesReportPage route={route} />
    case 'reports/inventory':
      return <InventoryReportPage route={route} />
  }
  const mod = findModule(route)
  if (mod) return <ModulePage module={mod} canWrite={canWrite} />
  return (
    <Notice kind="warning">
      Page not found. <a href="#/">Go to Home</a>
    </Notice>
  )
}
