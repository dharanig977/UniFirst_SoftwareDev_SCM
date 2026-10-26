// Second screen: a module's workspace with a tile for each task.
import { useCrmData } from '../data/CrmData'
import type { Module } from '../shell/modules'
import { Page, Tile } from '../shell/Page'

export function ModulePage({ module, canWrite }: { module: Module; canWrite: boolean }) {
  const { data } = useCrmData()

  const count = (path: string): { count?: number; label?: string; tone?: 'bad' | 'warn' } => {
    if (!data) return {}
    const today = new Date().toISOString().slice(0, 10)
    switch (path) {
      case 'customers/accounts':
        return { count: data.accounts.length, label: `accounts · ${data.accounts.filter((a) => a.account_status === 'Prospect').length} prospects` }
      case 'customers/contacts':
        return { count: data.contacts.length, label: 'contacts' }
      case 'customers/activities': {
        const overdue = data.activities.filter((a) => !a.is_done && a.due_date && a.due_date < today).length
        return { count: data.activities.filter((a) => !a.is_done).length, label: `open · ${overdue} overdue`, tone: overdue ? 'bad' : undefined }
      }
      case 'sales/pipeline':
        return { count: data.opportunities.filter((o) => !o.stage.startsWith('Closed')).length, label: 'open opportunities' }
      case 'planning/demand':
        return { count: data.forecasts.length, label: 'forecast lines' }
      case 'planning/budget':
        return { count: data.budgetVersions.length, label: 'versions' }
      case 'planning/prices':
        return { count: data.priceList.length, label: 'SKUs' }
      case 'orders/link':
        return { count: data.orders.length, label: 'orders linked' }
      default:
        return {}
    }
  }

  return (
    <Page route={module.id} title={module.title} subtitle={module.description}>
      <div className="tiles">
        {module.tasks.map((t) => {
          const c = count(t.path)
          return (
            <Tile key={t.path} to={t.path} title={t.title} description={t.description} icon={t.icon} count={c.count} countLabel={c.label} tone={c.tone} badge={t.write && !canWrite ? 'Read only' : undefined} />
          )
        })}
      </div>
    </Page>
  )
}
