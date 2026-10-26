// The navigation map: modules (second screen) and their tasks (third screen).
export interface Task {
  path: string
  title: string
  description: string
  icon: string
  /** Changes data (needs the operator role). */
  write?: boolean
}

export interface Module {
  id: string
  title: string
  description: string
  icon: string
  tasks: Task[]
}

export const MODULES: Module[] = [
  {
    id: 'purchase',
    title: 'Purchase',
    description: 'Raise purchase orders and receive goods from suppliers',
    icon: 'purchase',
    tasks: [
      { path: 'purchase/new', title: 'New purchase order', description: 'Raise a PO, or save it as a draft', icon: 'plus', write: true },
      { path: 'purchase/orders', title: 'All purchase orders', description: 'Search, review and confirm drafts', icon: 'list' },
      { path: 'purchase/receipt', title: 'Product receipt', description: 'Record goods received against a PO', icon: 'receive', write: true },
    ],
  },
  {
    id: 'sales',
    title: 'Sales',
    description: 'Create and track customer sales orders',
    icon: 'sales',
    tasks: [
      { path: 'sales/new', title: 'New sales order', description: 'Raise a sales order, or save it as a draft', icon: 'plus', write: true },
      { path: 'sales/orders', title: 'All sales orders', description: 'Search, review and confirm drafts', icon: 'list' },
    ],
  },
  {
    id: 'inventory',
    title: 'Inventory',
    description: 'On-hand stock, reconciliation and discrepancies',
    icon: 'inventory',
    tasks: [
      { path: 'inventory/on-hand', title: 'On-hand inventory', description: 'Stock by SKU and warehouse from the reconciliation view', icon: 'inventory' },
      { path: 'inventory/investigate', title: 'Discrepancy investigation', description: 'Explain differences and get recommendations', icon: 'investigate' },
    ],
  },
  {
    id: 'master',
    title: 'Master Data Management',
    description: 'Products, suppliers and warehouses',
    icon: 'master',
    tasks: [
      { path: 'master/products', title: 'Products', description: 'Released products (SKUs)', icon: 'product' },
      { path: 'master/products/new', title: 'New product', description: 'Create a new SKU', icon: 'plus', write: true },
      { path: 'master/suppliers', title: 'Suppliers', description: 'Vendors and lead times', icon: 'supplier' },
      { path: 'master/suppliers/new', title: 'New supplier', description: 'Create a new vendor', icon: 'plus', write: true },
      { path: 'master/warehouses', title: 'Warehouses', description: 'Sites in use across all transactions', icon: 'warehouse' },
    ],
  },
  {
    id: 'reports',
    title: 'Reports',
    description: 'Filtered order and inventory reports with export',
    icon: 'reports',
    tasks: [
      { path: 'reports/purchase', title: 'Purchase order report', description: 'Filter by Draft, Open, Pending, Closed', icon: 'reports' },
      { path: 'reports/sales', title: 'Sales order report', description: 'Filter by Draft, Open, Pending, Closed', icon: 'reports' },
      { path: 'reports/inventory', title: 'Inventory report', description: 'Stock position and discrepancies by warehouse', icon: 'reports' },
    ],
  },
]

export function findModule(id: string) {
  return MODULES.find((m) => m.id === id)
}

/** Breadcrumb trail for a route, e.g. "purchase/new" -> Home > Purchase > New purchase order. */
export function trail(route: string): { title: string; path: string }[] {
  const crumbs = [{ title: 'Home', path: '' }]
  const mod = findModule(route.split('/')[0])
  if (!mod) return crumbs
  crumbs.push({ title: mod.title, path: mod.id })
  const task = mod.tasks.find((t) => t.path === route)
  if (task) crumbs.push({ title: task.title, path: task.path })
  return crumbs
}
