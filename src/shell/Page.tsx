// Building blocks every page uses: breadcrumb + action pane + title,
// FastTabs (collapsible sections), tiles, grids and stage filters.
import { useMemo, useState, type ReactNode } from 'react'
import { href } from '../lib/router'
import { STAGE_HELP, STAGES, type Stage } from '../lib/stage'
import { Icon } from './Icon'
import { trail } from './modules'

export interface Action {
  label: string
  icon: string
  onClick?: () => void
  to?: string
  disabled?: boolean
  primary?: boolean
  title?: string
}

export function Page({ route, title, subtitle, actions, children }: { route: string; title: string; subtitle?: ReactNode; actions?: Action[]; children: ReactNode }) {
  const crumbs = trail(route)
  return (
    <div className="page">
      {actions && actions.length > 0 && (
        <div className="action-pane" role="toolbar">
          {actions.map((a) =>
            a.to && !a.disabled ? (
              <a key={a.label} className={`action${a.primary ? ' primary' : ''}`} href={href(a.to)} title={a.title}>
                <Icon name={a.icon} size={16} /> {a.label}
              </a>
            ) : (
              <button key={a.label} className={`action${a.primary ? ' primary' : ''}`} onClick={a.onClick} disabled={a.disabled} title={a.title}>
                <Icon name={a.icon} size={16} /> {a.label}
              </button>
            ),
          )}
        </div>
      )}
      <nav className="breadcrumb" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={c.path}>
            {i > 0 && <Icon name="chevron" size={12} className="crumb-sep" />}
            {i < crumbs.length - 1 ? <a href={href(c.path)}>{c.title}</a> : <span>{c.title}</span>}
          </span>
        ))}
      </nav>
      <div className="page-title">
        <h1>{title}</h1>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      <div className="page-body">{children}</div>
    </div>
  )
}

export function FastTab({ title, summary, defaultOpen = true, children }: { title: string; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`fasttab${open ? ' open' : ''}`}>
      <button type="button" className="fasttab-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="chevron" size={14} className="fasttab-chevron" />
        <span className="fasttab-title">{title}</span>
        {!open && summary && <span className="fasttab-summary">{summary}</span>}
      </button>
      {open && <div className="fasttab-body">{children}</div>}
    </section>
  )
}

export function Tile({ to, title, description, icon, count, countLabel, tone, badge }: { to: string; title: string; description?: string; icon: string; count?: number; countLabel?: string; tone?: 'bad' | 'warn'; badge?: string }) {
  return (
    <a className={`tile${tone ? ` tile-${tone}` : ''}`} href={href(to)}>
      <div className="tile-top">
        <Icon name={icon} size={26} />
        {badge && <span className="tile-badge">{badge}</span>}
      </div>
      <div className="tile-title">{title}</div>
      {description && <div className="tile-desc">{description}</div>}
      {count !== undefined && (
        <div className="tile-count">
          <strong>{count}</strong> {countLabel}
        </div>
      )}
    </a>
  )
}

export function StageFilter({ value, onChange, counts }: { value: Stage | 'All'; onChange: (s: Stage | 'All') => void; counts: Record<Stage, number> }) {
  const total = STAGES.reduce((s, k) => s + counts[k], 0)
  return (
    <div className="stage-filter" role="radiogroup" aria-label="Order type">
      {(['All', ...STAGES] as const).map((s) => (
        <button key={s} role="radio" aria-checked={value === s} className={value === s ? 'active' : ''} onClick={() => onChange(s)} title={s === 'All' ? 'All orders' : STAGE_HELP[s]}>
          {s} <span className="chip-count">{s === 'All' ? total : counts[s]}</span>
        </button>
      ))}
    </div>
  )
}

// ---------- Data grid with click-to-sort columns ----------

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  sortValue?: (row: T) => string | number | null
  numeric?: boolean
}

export function DataGrid<T>({ columns, rows, rowKey, selectedKey, onSelect, empty = 'No records.' }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; selectedKey?: string | null; onSelect?: (r: T) => void; empty?: string }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a)
      const vb = col.sortValue!(b)
      if (va === vb) return 0
      if (va === null) return 1
      if (vb === null) return -1
      return (va < vb ? -1 : 1) * sort.dir
    })
  }, [rows, sort, columns])

  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.numeric ? 'num' : undefined}>
                {c.sortValue ? (
                  <button className="th-sort" onClick={() => setSort(sort?.key === c.key ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })}>
                    {c.header}
                    {sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="empty">
                {empty}
              </td>
            </tr>
          )}
          {sorted.map((r) => {
            const k = rowKey(r)
            return (
              <tr key={k} className={`${onSelect ? 'clickable' : ''}${selectedKey === k ? ' selected' : ''}`} onClick={onSelect ? () => onSelect(r) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? 'num' : undefined}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Downloads rows as a CSV file (opens in Excel). */
export function exportCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v === null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
