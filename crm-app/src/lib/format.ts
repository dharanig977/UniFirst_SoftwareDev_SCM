// Number and date formatting used across pages.
export const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
export const money2 = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
export const qty = (n: number) => Math.round(n).toLocaleString()
export const pct = (n: number | null, digits = 1) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`)
export const shortDate = (d: string | null) => (d ? new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
export const today = () => new Date().toISOString().slice(0, 10)
