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
    id: 'customers',
    title: 'Customers',
    description: 'Accounts, contacts and activities',
    icon: 'account',
    tasks: [
      { path: 'customers/accounts', title: 'Accounts', description: 'All customer accounts', icon: 'account' },
      { path: 'customers/new', title: 'New account', description: 'Add a customer or prospect', icon: 'plus', write: true },
      { path: 'customers/contacts', title: 'Contacts', description: 'People at each account', icon: 'contact' },
      { path: 'customers/activities', title: 'Activities', description: 'Calls, meetings and tasks', icon: 'activity' },
    ],
  },
  {
    id: 'sales',
    title: 'Opportunities',
    description: 'Sales pipeline by stage',
    icon: 'opportunity',
    tasks: [
      { path: 'sales/pipeline', title: 'Pipeline', description: 'Opportunities by stage', icon: 'opportunity' },
      { path: 'sales/new', title: 'New opportunity', description: 'Log a new deal', icon: 'plus', write: true },
    ],
  },
  {
    id: 'planning',
    title: 'Demand & Budget',
    description: 'Customer demand forecasts and the sales budget',
    icon: 'forecast',
    tasks: [
      { path: 'planning/demand', title: 'Demand forecast', description: 'What each customer expects to buy, by month', icon: 'forecast', write: true },
      { path: 'planning/budget', title: 'Sales budget', description: 'What we plan to sell, by version', icon: 'budget', write: true },
      { path: 'planning/prices', title: 'Price list', description: 'Selling price per ERP SKU', icon: 'product' },
    ],
  },
  {
    id: 'orders',
    title: 'ERP Orders',
    description: 'Link ERP sales orders to customers (actuals)',
    icon: 'link',
    tasks: [{ path: 'orders/link', title: 'Link ERP sales orders', description: 'Give each ERP order its customer and price', icon: 'link', write: true }],
  },
  {
    id: 'reports',
    title: 'Reports',
    description: 'Demand vs Actual vs Budget, and pipeline',
    icon: 'reports',
    tasks: [
      { path: 'reports/dab', title: 'Demand vs Actual vs Budget', description: 'By month, customer, SKU or warehouse', icon: 'chart' },
      { path: 'reports/pipeline', title: 'Pipeline report', description: 'Open and weighted pipeline by owner and stage', icon: 'reports' },
    ],
  },
]

export function findModule(id: string) {
  return MODULES.find((m) => m.id === id)
}

/** Breadcrumb trail for a route, e.g. "customers/accounts/ACC-1001" -> Home > Customers > Accounts > ACC-1001. */
export function trail(route: string): { title: string; path: string }[] {
  const crumbs = [{ title: 'Home', path: '' }]
  const mod = findModule(route.split('/')[0])
  if (!mod) return crumbs
  crumbs.push({ title: mod.title, path: mod.id })
  const task = mod.tasks.find((t) => t.path === route || route.startsWith(t.path + '/'))
  if (task) crumbs.push({ title: task.title, path: task.path })
  if (task && route !== task.path) crumbs.push({ title: route.slice(task.path.length + 1), path: route })
  return crumbs
}
