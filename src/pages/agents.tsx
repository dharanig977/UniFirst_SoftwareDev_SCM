// AI Agents module: sales order agent, approvals, shipping with bin deduction,
// bins and the e-mail outbox (shortage alerts + weekly sales report).
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Notice } from '../components/Notice'
import { StatusBadge } from '../components/StatusBadge'
import {
  askSalesAgent,
  decideOrder,
  listApprovals,
  listBins,
  listMovements,
  listNotifications,
  listOrderStock,
  queueWeeklyReport,
  runApproverOnPending,
  sendQueuedEmails,
  shipOrder,
  type AgentReply,
  type Approval,
  type Bin,
  type Movement,
  type Notification,
  type OrderStock,
  type ShipResult,
} from '../data/agents'
import { useErpData } from '../data/ErpData'
import { DataGrid, FastTab, Page, type Column } from '../shell/Page'
import { useSubmit } from '../shell/useSubmit'

type Tone = 'neutral' | 'good' | 'warn' | 'bad'
const money = (n: number | null | undefined) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const stockTone = (s: string): Tone => (s === 'Available' ? 'good' : s === 'Partial' ? 'warn' : 'bad')
const approvalTone = (s: string): Tone => (s === 'Approved' ? 'good' : s === 'Rejected' ? 'bad' : s === 'Needs Approval' ? 'warn' : 'neutral')
const mailTone = (s: string): Tone => (s === 'Sent' ? 'good' : s === 'Failed' ? 'bad' : 'neutral')

/** Loads one list and lets the page reload it. */
function useList<T>(load: () => Promise<T[]>) {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await load())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [load])
  useEffect(() => {
    void reload()
  }, [reload])
  return { rows, loading, error, reload }
}

// ---------------------------------------------------------------------------
// Sales order agent
// ---------------------------------------------------------------------------
const EXAMPLES = [
  'Bluegrass Metal Works needs 40 Flame-Resistant Coveralls from Kentucky',
  'Derby City Foods wants 10 Chef Coats',
  'Raise an order for Buckeye Steel: 25 high-visibility vests from Ohio',
]

export function SalesAgentPage({ route, canWrite }: { route: string; canWrite: boolean }) {
  const { reload } = useErpData()
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<{ ask: string; answer: AgentReply }[]>([])
  const submit = useSubmit()

  const send = (e?: FormEvent) => {
    e?.preventDefault()
    const text = message.trim()
    if (!text) return
    void submit.run(async () => {
      const answer = await askSalesAgent(text)
      setHistory((h) => [{ ask: text, answer }, ...h])
      setMessage('')
      await reload()
      return answer.error ? `Agent error: ${answer.error}` : 'Agent finished.'
    })
  }

  return (
    <Page
      route={route}
      title="Sales order agent"
      subtitle="Type the request in plain English. The agent looks up the customer, product, price and stock, creates a Draft order and hands it to the approver agent."
      actions={[
        { label: 'Send', icon: 'check', onClick: send, disabled: !canWrite || submit.saving || !message.trim(), primary: true },
        { label: 'Approvals', icon: 'list', to: 'agents/approvals' },
      ]}
    >
      {!canWrite && <Notice kind="info">Your account is read-only. The agent needs the operator role because it creates orders.</Notice>}
      <form onSubmit={send}>
        <FastTab title="Request">
          <textarea className="agent-input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={EXAMPLES[0]} disabled={!canWrite || submit.saving} />
          <div className="chip-row">
            {EXAMPLES.map((x) => (
              <button type="button" key={x} className="chip" onClick={() => setMessage(x)} disabled={!canWrite || submit.saving}>
                {x}
              </button>
            ))}
          </div>
          <div className="form-footer">
            <button type="submit" className="primary" disabled={!canWrite || submit.saving || !message.trim()}>
              {submit.saving ? 'Agent is working…' : 'Send to agent'}
            </button>
          </div>
        </FastTab>
      </form>
      {submit.saving && <Notice kind="loading">The sales order agent is looking up the customer, product and stock…</Notice>}
      {submit.result?.kind === 'error' && (
        <Notice kind="error" onClose={() => submit.setResult(null)}>
          {submit.result.text}
        </Notice>
      )}
      {history.map((h, i) => (
        <FastTab key={i} title={h.ask} summary={h.answer.created?.length ? `${h.answer.created.length} order(s)` : undefined}>
          {h.answer.error && <Notice kind="error">{h.answer.error}</Notice>}
          {h.answer.reply && <p className="agent-reply">{h.answer.reply}</p>}
          {(h.answer.created ?? []).map((c) => (
            <dl className="facts" key={c.order.sales_order_id}>
              <div><dt>Order</dt><dd className="mono">{c.order.sales_order_id}</dd></div>
              <div><dt>Amount</dt><dd>{money(c.order.amount)}</dd></div>
              <div><dt>Stock check</dt><dd><StatusBadge tone={stockTone(c.order.stock_status)} text={c.order.stock_status} /></dd></div>
              <div><dt>Approver agent</dt><dd>{c.approval.approval_status ? <StatusBadge tone={approvalTone(c.approval.approval_status)} text={c.approval.approval_status} /> : c.approval.error}</dd></div>
              <div className="wide"><dt>Reason</dt><dd>{c.approval.ai_explanation ?? c.approval.decision_reason}</dd></div>
            </dl>
          ))}
          {h.answer.steps && h.answer.steps.length > 0 && <p className="muted small">Tools used: {h.answer.steps.map((s) => s.tool + (s.ok ? '' : ' (failed)')).join(' → ')}</p>}
        </FastTab>
      ))}
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------
export function ApprovalsPage({ route, canWrite }: { route: string; canWrite: boolean }) {
  const { reload: reloadErp } = useErpData()
  const { rows, loading, error, reload } = useList(listApprovals)
  const [filter, setFilter] = useState<'All' | Approval['approval_status']>('Needs Approval')
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const submit = useSubmit()
  const shown = rows.filter((r) => filter === 'All' || r.approval_status === filter)
  const sel = rows.find((r) => r.sales_order_id === selected) ?? null
  const counts = useMemo(() => Object.fromEntries(['Pending', 'Needs Approval', 'Approved', 'Rejected'].map((s) => [s, rows.filter((r) => r.approval_status === s).length])), [rows])

  const decide = (approve: boolean) =>
    sel &&
    submit.run(async () => {
      const r = await decideOrder(sel.sales_order_id, approve, note)
      setNote('')
      await Promise.all([reload(), reloadErp()])
      return `${r.sales_order_id} ${r.approval_status.toLowerCase()}.`
    })
  const runPending = () =>
    submit.run(async () => {
      const r = await runApproverOnPending()
      await Promise.all([reload(), reloadErp()])
      return `Approver agent reviewed ${r.results.length} pending order(s).`
    })

  const cols: Column<Approval>[] = [
    { key: 'so', header: 'Sales order', render: (r) => <span className="mono link-text">{r.sales_order_id}</span>, sortValue: (r) => r.sales_order_id },
    { key: 'cust', header: 'Customer', render: (r) => r.account_name ?? '—', sortValue: (r) => r.account_name },
    { key: 'sku', header: 'Item', render: (r) => <span className="mono">{r.sku}</span>, sortValue: (r) => r.sku },
    { key: 'wh', header: 'Warehouse', render: (r) => <span className="mono">{r.warehouse_id}</span>, sortValue: (r) => r.warehouse_id },
    { key: 'qty', header: 'Qty', render: (r) => r.order_qty, sortValue: (r) => r.order_qty, numeric: true },
    { key: 'amt', header: 'Amount', render: (r) => money(r.amount), sortValue: (r) => Number(r.amount), numeric: true },
    { key: 'stock', header: 'Stock check', render: (r) => <StatusBadge tone={stockTone(r.stock_status)} text={r.stock_status} />, sortValue: (r) => r.stock_status },
    { key: 'appr', header: 'Approval', render: (r) => <StatusBadge tone={approvalTone(r.approval_status)} text={r.approval_status} />, sortValue: (r) => r.approval_status },
    { key: 'by', header: 'Decided by', render: (r) => r.decided_by ?? '—', sortValue: (r) => r.decided_by },
  ]

  return (
    <Page
      route={route}
      title="Sales order approvals"
      subtitle="The approver agent approves orders up to $1,000 when stock is available. Bigger orders and stock shortfalls wait here for a person."
      actions={[
        { label: 'Approve', icon: 'check', onClick: () => void decide(true), disabled: !canWrite || !sel || !['Needs Approval', 'Pending'].includes(sel.approval_status) || submit.saving, primary: true },
        { label: 'Reject', icon: 'alert', onClick: () => void decide(false), disabled: !canWrite || !sel || !['Needs Approval', 'Pending'].includes(sel.approval_status) || submit.saving },
        { label: 'Run approver on pending', icon: 'refresh', onClick: () => void runPending(), disabled: !canWrite || submit.saving || !counts.Pending },
        { label: 'Refresh', icon: 'refresh', onClick: () => void reload(), disabled: loading },
      ]}
    >
      <div className="filter-bar">
        <div className="stage-filter" role="group">
          {(['Needs Approval', 'Pending', 'Approved', 'Rejected', 'All'] as const).map((s) => (
            <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>
              {s} {s !== 'All' && <span className="muted">({counts[s] ?? 0})</span>}
            </button>
          ))}
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {submit.result && (
        <Notice kind={submit.result.kind} onClose={() => submit.setResult(null)}>
          {submit.result.text}
        </Notice>
      )}
      <DataGrid columns={cols} rows={shown} rowKey={(r) => r.sales_order_id} selectedKey={selected} onSelect={(r) => setSelected(r.sales_order_id)} empty={loading ? 'Loading…' : 'No orders in this view.'} />
      {sel && (
        <div className="details">
          <FastTab title={`Sales order ${sel.sales_order_id}`} summary={sel.approval_status}>
            <dl className="facts">
              <div><dt>Customer</dt><dd>{sel.account_name} ({sel.account_id})</dd></div>
              <div><dt>Unit price</dt><dd>{money(sel.unit_price)}</dd></div>
              <div><dt>Amount</dt><dd>{money(sel.amount)}</dd></div>
              <div><dt>Available at check</dt><dd>{sel.available_at_check}</dd></div>
              <div><dt>Requested by</dt><dd>{sel.requested_by}</dd></div>
              <div><dt>ERP status</dt><dd>{sel.status}</dd></div>
              {sel.request_text && <div className="wide"><dt>Original request</dt><dd>“{sel.request_text}”</dd></div>}
              <div className="wide"><dt>Rule decision</dt><dd>{sel.decision_reason}</dd></div>
              {sel.ai_explanation && <div className="wide"><dt>Approver agent says</dt><dd>{sel.ai_explanation}</dd></div>}
            </dl>
            {canWrite && ['Needs Approval', 'Pending'].includes(sel.approval_status) && (
              <div className="form-footer">
                <input className="grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the decision (optional)" />
                <button className="primary" onClick={() => void decide(true)} disabled={submit.saving}>Approve</button>
                <button onClick={() => void decide(false)} disabled={submit.saving}>Reject</button>
              </div>
            )}
          </FastTab>
        </div>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Ship orders (stock deduction from bins + shortage alert)
// ---------------------------------------------------------------------------
export function ShipOrdersPage({ route, canWrite }: { route: string; canWrite: boolean }) {
  const { reload: reloadErp } = useErpData()
  const stock = useList(listOrderStock)
  const approvals = useList(listApprovals)
  const [selected, setSelected] = useState<string | null>(null)
  const [last, setLast] = useState<ShipResult | null>(null)
  const submit = useSubmit()
  const approvalOf = useMemo(() => new Map(approvals.rows.map((a) => [a.sales_order_id, a.approval_status])), [approvals.rows])
  const shippable = (r: OrderStock) => ['Open', 'Partially Shipped'].includes(r.status) && (approvalOf.get(r.sales_order_id) ?? 'Approved') === 'Approved'
  const sel = stock.rows.find((r) => r.sales_order_id === selected) ?? null

  const ship = () =>
    sel &&
    submit.run(async () => {
      const r = await shipOrder(sel.sales_order_id, null)
      setLast(r)
      await Promise.all([stock.reload(), approvals.reload(), reloadErp()])
      return `${r.sales_order_id}: shipped ${r.shipped_now}${r.qty_short ? `, ${r.qty_short} short` : ''}. Status ${r.status}.${r.shortage_alert_id ? ' Shortage alert queued for the inventory team.' : ''}`
    })

  const cols: Column<OrderStock>[] = [
    { key: 'so', header: 'Sales order', render: (r) => <span className="mono link-text">{r.sales_order_id}</span>, sortValue: (r) => r.sales_order_id },
    { key: 'sku', header: 'Item', render: (r) => <span className="mono">{r.sku}</span>, sortValue: (r) => r.sku },
    { key: 'wh', header: 'Warehouse', render: (r) => <span className="mono">{r.warehouse_id}</span>, sortValue: (r) => r.warehouse_id },
    { key: 'st', header: 'Status', render: (r) => r.status, sortValue: (r) => r.status },
    { key: 'appr', header: 'Approval', render: (r) => approvalOf.get(r.sales_order_id) ?? 'Manual order', sortValue: (r) => approvalOf.get(r.sales_order_id) ?? '' },
    { key: 'open', header: 'Open qty', render: (r) => r.open_qty, sortValue: (r) => r.open_qty, numeric: true },
    { key: 'oh', header: 'In bins', render: (r) => r.on_hand, sortValue: (r) => r.on_hand, numeric: true },
    { key: 'res', header: 'Reserved by others', render: (r) => r.reserved_by_others, sortValue: (r) => r.reserved_by_others, numeric: true },
    { key: 'av', header: 'Available', render: (r) => r.available, sortValue: (r) => r.available, numeric: true },
    { key: 'chk', header: 'Stock check', render: (r) => <StatusBadge tone={stockTone(r.stock_status)} text={r.stock_status} />, sortValue: (r) => r.stock_status },
  ]

  return (
    <Page
      route={route}
      title="Ship orders"
      subtitle="Every open order is checked against bin stock automatically. Shipping takes stock out of the fullest bin first; if stock runs short the inventory team gets an alert with bin details."
      actions={[
        { label: 'Ship', icon: 'receive', onClick: () => void ship(), disabled: !canWrite || !sel || !shippable(sel) || submit.saving, primary: true },
        { label: 'Refresh', icon: 'refresh', onClick: () => void stock.reload(), disabled: stock.loading },
      ]}
    >
      {stock.error && <Notice kind="error">{stock.error}</Notice>}
      {submit.result && (
        <Notice kind={submit.result.kind} onClose={() => submit.setResult(null)}>
          {submit.result.text}
        </Notice>
      )}
      {last && (
        <FastTab title={`Bins after shipping ${last.sales_order_id}`} summary={`${last.total_on_hand_after} left`}>
          <table className="grid compact">
            <thead><tr><th>Bin</th><th className="num">Qty on hand</th><th className="num">Reorder point</th></tr></thead>
            <tbody>
              {last.bins.map((b) => (
                <tr key={b.bin_code}><td className="mono">{b.bin_code}</td><td className="num">{b.qty_on_hand}</td><td className="num">{b.reorder_point}</td></tr>
              ))}
            </tbody>
          </table>
        </FastTab>
      )}
      <DataGrid columns={cols} rows={stock.rows} rowKey={(r) => r.sales_order_id} selectedKey={selected} onSelect={(r) => setSelected(r.sales_order_id)} empty={stock.loading ? 'Loading…' : 'No open orders.'} />
      {sel && !shippable(sel) && <Notice kind="info">{sel.sales_order_id} can't ship yet: it must be approved and Open first.</Notice>}
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Bins and stock movements
// ---------------------------------------------------------------------------
export function BinsPage({ route }: { route: string }) {
  const bins = useList(listBins)
  const moves = useList(listMovements)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const rows = bins.rows.filter((b) => !q || [b.bin_code, b.sku, b.warehouse_id].join(' ').toLowerCase().includes(q))
  const cols: Column<Bin>[] = [
    { key: 'bin', header: 'Bin', render: (b) => <span className="mono">{b.bin_code}</span>, sortValue: (b) => b.bin_code },
    { key: 'wh', header: 'Warehouse', render: (b) => <span className="mono">{b.warehouse_id}</span>, sortValue: (b) => b.warehouse_id },
    { key: 'sku', header: 'Item', render: (b) => <span className="mono">{b.sku}</span>, sortValue: (b) => b.sku },
    { key: 'qty', header: 'Qty on hand', render: (b) => b.qty_on_hand, sortValue: (b) => b.qty_on_hand, numeric: true },
    { key: 'rop', header: 'Reorder point', render: (b) => b.reorder_point, sortValue: (b) => b.reorder_point, numeric: true },
    { key: 'flag', header: 'Level', render: (b) => <StatusBadge tone={b.qty_on_hand === 0 ? 'bad' : b.qty_on_hand < b.reorder_point ? 'warn' : 'good'} text={b.qty_on_hand === 0 ? 'Empty' : b.qty_on_hand < b.reorder_point ? 'Low' : 'OK'} />, sortValue: (b) => b.qty_on_hand - b.reorder_point },
  ]
  const moveCols: Column<Movement>[] = [
    { key: 'id', header: '#', render: (m) => m.movement_id, sortValue: (m) => m.movement_id, numeric: true },
    { key: 'so', header: 'Sales order', render: (m) => <span className="mono">{m.sales_order_id}</span>, sortValue: (m) => m.sales_order_id },
    { key: 'sku', header: 'Item', render: (m) => <span className="mono">{m.sku}</span>, sortValue: (m) => m.sku },
    { key: 'bin', header: 'Bin', render: (m) => bins.rows.find((b) => b.bin_id === m.bin_id)?.bin_code ?? m.bin_id, sortValue: (m) => m.bin_id },
    { key: 'chg', header: 'Change', render: (m) => m.qty_change, sortValue: (m) => m.qty_change, numeric: true },
    { key: 'after', header: 'Left in bin', render: (m) => m.qty_after, sortValue: (m) => m.qty_after, numeric: true },
    { key: 'by', header: 'By', render: (m) => m.created_by ?? '—', sortValue: (m) => m.created_by },
    { key: 'at', header: 'When', render: (m) => new Date(m.created_at).toLocaleString(), sortValue: (m) => m.created_at },
  ]
  return (
    <Page route={route} title="Bins" subtitle="Bin locations per SKU and warehouse. Shipping deducts from these bins." actions={[{ label: 'Refresh', icon: 'refresh', onClick: () => void Promise.all([bins.reload(), moves.reload()]) }]}>
      <div className="filter-bar">
        <input type="search" placeholder="Filter by bin, item, warehouse…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter bins" />
      </div>
      {bins.error && <Notice kind="error">{bins.error}</Notice>}
      <DataGrid columns={cols} rows={rows} rowKey={(b) => String(b.bin_id)} empty={bins.loading ? 'Loading…' : 'No bins.'} />
      <FastTab title="Stock movements" summary={`${moves.rows.length}`} defaultOpen={moves.rows.length > 0}>
        <DataGrid columns={moveCols} rows={moves.rows} rowKey={(m) => String(m.movement_id)} empty="Nothing shipped through bins yet." />
      </FastTab>
    </Page>
  )
}

// ---------------------------------------------------------------------------
// E-mail outbox
// ---------------------------------------------------------------------------
export function NotificationsPage({ route, canWrite }: { route: string; canWrite: boolean }) {
  const { rows, loading, error, reload } = useList(listNotifications)
  const [selected, setSelected] = useState<number | null>(null)
  const submit = useSubmit()
  const sel = rows.find((r) => r.notification_id === selected) ?? null

  const queue = () =>
    submit.run(async () => {
      const id = await queueWeeklyReport()
      await reload()
      setSelected(id)
      return `Weekly report for last week queued (#${id}). It goes out on the next send (every 5 minutes).`
    })
  const sendNow = () =>
    submit.run(async () => {
      const r = await sendQueuedEmails()
      await reload()
      const failed = r.results.filter((x) => !x.sent)
      return `Sent ${r.sent} e-mail(s).${failed.length ? ` ${failed.length} failed: ${failed[0].error}` : ''}`
    })

  const cols: Column<Notification>[] = [
    { key: 'id', header: '#', render: (n) => n.notification_id, sortValue: (n) => n.notification_id, numeric: true },
    { key: 'kind', header: 'Type', render: (n) => n.kind, sortValue: (n) => n.kind },
    { key: 'subj', header: 'Subject', render: (n) => n.subject, sortValue: (n) => n.subject },
    { key: 'st', header: 'Status', render: (n) => <StatusBadge tone={mailTone(n.status)} text={n.status} />, sortValue: (n) => n.status },
    { key: 'to', header: 'Recipient set', render: (n) => (n.has_recipient ? 'Yes' : 'Not yet'), sortValue: (n) => (n.has_recipient ? 1 : 0) },
    { key: 'at', header: 'Created', render: (n) => new Date(n.created_at).toLocaleString(), sortValue: (n) => n.created_at },
    { key: 'sent', header: 'Sent', render: (n) => (n.sent_at ? new Date(n.sent_at).toLocaleString() : '—'), sortValue: (n) => n.sent_at },
  ]

  return (
    <Page
      route={route}
      title="E-mail outbox"
      subtitle="Shortage alerts go to the inventory team; the weekly report (orders above $1,000) goes to the sales head every Monday. Queued e-mails are sent every 5 minutes."
      actions={[
        { label: 'Queue weekly report now', icon: 'reports', onClick: () => void queue(), disabled: !canWrite || submit.saving },
        { label: 'Send queued now', icon: 'check', onClick: () => void sendNow(), disabled: !canWrite || submit.saving, primary: true },
        { label: 'Refresh', icon: 'refresh', onClick: () => void reload(), disabled: loading },
      ]}
    >
      {error && <Notice kind="error">{error}</Notice>}
      {submit.result && (
        <Notice kind={submit.result.kind} onClose={() => submit.setResult(null)}>
          {submit.result.text}
        </Notice>
      )}
      <DataGrid columns={cols} rows={rows} rowKey={(n) => String(n.notification_id)} selectedKey={selected == null ? null : String(selected)} onSelect={(n) => setSelected(n.notification_id)} empty={loading ? 'Loading…' : 'No e-mails yet.'} />
      {sel && (
        <div className="details">
          <FastTab title={sel.subject} summary={sel.status}>
            {sel.error && <Notice kind="error">{sel.error}</Notice>}
            {/* The body is HTML built by the database from ERP data; shown in a sandboxed frame. */}
            <iframe className="mail-preview" title="E-mail preview" sandbox="" srcDoc={`<body style="font-family:system-ui,sans-serif;font-size:14px">${sel.body_html}</body>`} />
          </FastTab>
        </div>
      )}
    </Page>
  )
}
