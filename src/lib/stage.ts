// Maps each order to one of the four report stages the business uses.
//   Draft   = saved but not yet confirmed/sent
//   Open    = confirmed, nothing received/shipped yet
//   Pending = partly received/shipped (work in progress)
//   Closed  = fully received/shipped, or closed/cancelled
// The stored status text is kept as-is; the stage is calculated from it plus
// the actual received/shipped quantities, so stale status text can't hide reality.
import type { PoSummary } from './logic'
import type { SalesOrder } from './types'

export const STAGES = ['Draft', 'Open', 'Pending', 'Closed'] as const
export type Stage = (typeof STAGES)[number]

const CLOSED_WORDS = ['closed', 'cancelled', 'canceled', 'received', 'shipped', 'invoiced']

export function purchaseStage(s: PoSummary): Stage {
  const status = (s.po.status ?? '').trim().toLowerCase()
  if (status === 'draft') return 'Draft'
  if (s.remainingQty <= 0 || CLOSED_WORDS.includes(status)) return 'Closed'
  if (s.receivedQty > 0) return 'Pending'
  return 'Open'
}

export function salesStage(so: SalesOrder): Stage {
  const status = (so.status ?? '').trim().toLowerCase()
  if (status === 'draft') return 'Draft'
  const ordered = so.order_qty ?? 0
  const shipped = so.shipped_qty ?? 0
  if ((ordered > 0 && shipped >= ordered) || CLOSED_WORDS.includes(status)) return 'Closed'
  if (shipped > 0) return 'Pending'
  return 'Open'
}

export const STAGE_HELP: Record<Stage, string> = {
  Draft: 'Saved but not confirmed yet',
  Open: 'Confirmed, nothing received or shipped yet',
  Pending: 'Partly received or shipped',
  Closed: 'Fully received or shipped, or closed',
}

export function stageTone(stage: Stage): 'neutral' | 'good' | 'warn' | 'bad' {
  return stage === 'Closed' ? 'good' : stage === 'Pending' ? 'warn' : 'neutral'
}
