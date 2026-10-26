// The ERP frame: top bar, left navigation pane, and the content area.
import { useEffect, useState, type ReactNode } from 'react'
import { signOut } from '../data/auth'
import { href, navigate } from '../lib/router'
import { Icon } from './Icon'
import { MODULES } from './modules'

interface Props {
  route: string
  userName: string
  userEmail: string
  role: string | null
  children: ReactNode
}

export function AppShell({ route, userName, userEmail, role, children }: Props) {
  const isNarrow = () => window.matchMedia('(max-width: 720px)').matches
  const [navOpen, setNavOpen] = useState(() => !isNarrow())
  // On phones the navigation pane overlays the page, so close it after navigating.
  useEffect(() => {
    if (isNarrow()) setNavOpen(false)
  }, [route])
  const [menuOpen, setMenuOpen] = useState(false)
  const initials = userName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
  const activeModule = route.split('/')[0]

  return (
    <div className={`shell${navOpen ? '' : ' nav-collapsed'}`}>
      <header className="topbar">
        <button className="icon-btn" onClick={() => setNavOpen(!navOpen)} aria-label="Toggle navigation" title="Toggle navigation">
          <Icon name="waffle" />
        </button>
        <a className="brand" href={href('')}>
          UniFirst SCM
          <span className="brand-sub">Supply Chain Operations</span>
        </a>
        <TaskSearch />
        <span className="entity" title="Legal entity">
          UFS
        </span>
        <div className="user-menu">
          <button className="avatar" onClick={() => setMenuOpen(!menuOpen)} aria-label="Account menu" title={userEmail}>
            {initials || '?'}
          </button>
          {menuOpen && (
            <div className="menu" role="menu" onMouseLeave={() => setMenuOpen(false)}>
              <div className="menu-head">
                <strong>{userName}</strong>
                <span>{userEmail}</span>
                <span className="muted small">Role: {role ?? 'none'}</span>
              </div>
              <button role="menuitem" onClick={() => void signOut()}>
                <Icon name="signout" size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <nav className="navpane" aria-label="Modules">
        <a className={`nav-item${route === '' ? ' active' : ''}`} href={href('')}>
          <Icon name="home" /> <span>Home</span>
        </a>
        <div className="nav-heading">Modules</div>
        {MODULES.map((m) => (
          <div key={m.id} className="nav-group">
            <a className={`nav-item${activeModule === m.id ? ' active' : ''}`} href={href(m.id)}>
              <Icon name={m.icon} /> <span>{m.title}</span>
            </a>
            {activeModule === m.id && (
              <div className="nav-sub">
                {m.tasks.map((t) => (
                  <a key={t.path} className={`nav-subitem${route === t.path ? ' active' : ''}`} href={href(t.path)}>
                    {t.title}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <main className="content">{children}</main>
    </div>
  )
}

// Search box in the top bar: type a task name and jump to it.
function TaskSearch() {
  const [q, setQ] = useState('')
  const all = MODULES.flatMap((m) => [{ path: m.id, title: m.title, sub: 'Module' }, ...m.tasks.map((t) => ({ path: t.path, title: t.title, sub: m.title }))])
  const hits = q.trim() ? all.filter((x) => x.title.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 7) : []
  const go = (path: string) => {
    navigate(path)
    setQ('')
  }
  return (
    <div className="task-search">
      <Icon name="search" size={16} />
      <input
        placeholder="Search for a page"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) go(hits[0].path)
          if (e.key === 'Escape') setQ('')
        }}
        aria-label="Search for a page"
      />
      {hits.length > 0 && (
        <div className="search-results" role="listbox">
          {hits.map((h) => (
            <button key={h.path} role="option" onClick={() => go(h.path)}>
              {h.title} <span className="muted small">{h.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
