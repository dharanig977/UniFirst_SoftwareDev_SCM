// Simple line icons (inline SVG, no icon library needed).
const PATHS: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  purchase: 'M3 4h2l2.4 11h11.2L21 7H7 M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  sales: 'M4 19h16 M6 16V9 M11 16V5 M16 16v-5 M20 7l-4 4-5-5-5 4',
  inventory: 'M3 8l9-5 9 5v9l-9 5-9-5z M3 8l9 5 9-5 M12 13v9',
  master: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  reports: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h7 M9 9h3',
  plus: 'M12 5v14 M5 12h14',
  list: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
  receive: 'M12 3v12 M7 10l5 5 5-5 M4 21h16',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
  check: 'M5 12l5 5 9-10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-5-5',
  waffle: 'M5 5h2v2H5z M11 5h2v2h-2z M17 5h2v2h-2z M5 11h2v2H5z M11 11h2v2h-2z M17 11h2v2h-2z M5 17h2v2H5z M11 17h2v2h-2z M17 17h2v2h-2z',
  alert: 'M12 3l10 18H2z M12 10v5 M12 18h.01',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  warehouse: 'M3 21V9l9-5 9 5v12 M7 21v-8h10v8 M7 17h10',
  supplier: 'M3 7h11v9H3z M14 10h4l3 3v3h-7z M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  product: 'M4 7l8-4 8 4-8 4z M4 7v10l8 4 8-4V7 M12 11v10',
  investigate: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-6-6 M10 7v4 M10 13h.01',
  chevron: 'M9 6l6 6-6 6',
  signout: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10',
}

export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {(PATHS[name] ?? PATHS.list).split(' M').map((d, i) => (
        <path key={i} d={i === 0 ? d : 'M' + d} />
      ))}
    </svg>
  )
}
