// Second screen: a module's workspace with a tile for each task.
import { useErpData } from '../data/ErpData'
import { investigate } from '../lib/logic'
import { purchaseStage, salesStage } from '../lib/stage'
import type { Module } from '../shell/modules'
import { Page, Tile } from '../shell/Page'

export function ModulePage({ module, canWrite }: { module: Module; canWrite: boolean }) {
  const { data } = useErpData()

  // A live count on each tile, where one makes sense.
  const count = (path: string): { count?: number; label?: string; tone?: 'bad' | 'warn' } => {
    if (!data) return {}
    switch (path) {
      case 'purchase/orders': {
        const overdue = data.poSummaries.filter((s) => s.isOverdue).length
        return { count: data.purchaseOrders.length, label: `orders · ${overdue} overdue`, tone: overdue ? 'bad' : undefined }
      }
      case 'purchase/receipt':
        return { count: data.poSummaries.filter((s) => s.isOpen).length, label: 'POs awaiting goods' }
      case 'sales/orders':
        return { count: data.salesOrders.length, label: `orders · ${data.salesOrders.filter((s) => salesStage(s) === 'Draft').length} draft` }
      case 'inventory/on-hand':
        return { count: data.reconciliation.reduce((s, r) => s + (r.adjusted_available ?? 0), 0), label: 'units available' }
      case 'inventory/investigate': {
        const n = data.reconciliation.filter(
          (row) => investigate({ row, snapshot: data.snapshots.find((s) => s.snapshot_id === row.snapshot_id), receipts: data.receipts, salesOrders: data.salesOrders, poSummaries: data.poSummaries }).length > 0,
        ).length
        return { count: n, label: 'positions to review', tone: n ? 'warn' : undefined }
      }
      case 'master/products':
        return { count: data.products.length, label: 'products' }
      case 'master/suppliers':
        return { count: data.suppliers.length, label: 'suppliers' }
      case 'master/warehouses':
        return { count: data.warehouses.length, label: 'warehouses' }
      case 'reports/purchase':
        return { count: data.poSummaries.filter((s) => ['Open', 'Pending'].includes(purchaseStage(s))).length, label: 'open or pending' }
      case 'reports/sales':
        return { count: data.salesOrders.filter((s) => ['Open', 'Pending'].includes(salesStage(s))).length, label: 'open or pending' }
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
