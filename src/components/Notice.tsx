import type { ReactNode } from 'react'

export type NoticeKind = 'loading' | 'success' | 'error' | 'warning' | 'info'

export function Notice({ kind, children, onClose }: { kind: NoticeKind; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'loading' && <span className="spinner" aria-hidden />}
      <div className="notice-body">{children}</div>
      {onClose && (
        <button type="button" className="link" onClick={onClose} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}
