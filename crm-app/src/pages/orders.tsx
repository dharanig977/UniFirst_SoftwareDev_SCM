// ERP Orders: give each ERP sales order its customer and price. The ERP is
// only read; the link is stored in the CRM (crm.orders).
import { useEffect, useState } from 'react'
import { Notice } from '../components/Notice'
import { StatusBadge } from '../components/StatusBadge'
import { useCrmData } from '../data/CrmData'
import { api, listErpSalesOrders, type AutoLinkResult } from '../lib/api'
import { money, shortDate } from '../lib/format'
import { href } from '../lib/router'
import type { ErpSalesOrder } from '../lib/types'
import { DataGrid, Page } from '../shell/Page'
import { useSubmit } from '../shell/useSubmit'

type P = { route: string; canWrite: boolean }

export function LinkOrdersPage({ route, canWrite }: P) {
  const { data, reload, accountById } = useCrmData()
  const [erp, setErp] = useState<ErpSalesOrder[] | null>(null)
  const [erpError, setErpError] = useState<string | null>(null)
  const [show, setShow] = useState<'unlinked' | 'linked' | 'all'>('unlinked')
  const [auto, setAuto] = useState<AutoLinkResult | null>(null)
  const s = useSubmit()

  const loadErp = async () => {
    setErpError(null)
    try {
      setErp(await listErpSalesOrders())
    } catch (e) {
      setErpError(e instanceof Error ? e.message : String(e))
    }
  }
  useEffect(() => {
    void loadErp()
  }, [])

  const links = new Map(data!.orders.map((o) => [o.erp_sales_order_id, o]))
  const isDraft = (o: ErpSalesOrder) => (o.status ?? '').toLowerCase() === 'draft'
  const rows = (erp ?? []).filter((o) => (show === 'all' ? true : show === 'linked' ? links.has(o.sales_order_id) : !links.has(o.sales_order_id) && !isDraft(o)))
  const unlinked = (erp ?? []).filter((o) => !links.has(o.sales_order_id) && !isDraft(o)).length

  const runAuto = () =>
    void s.run(async () => {
      const r = await api.autoLink()
      setAuto(r)
      await reload()
      return `Linked ${r.linked} new order(s). ${r.alreadyLinked + r.refreshed} were already linked${r.refreshed ? ` (${r.refreshed} updated from the ERP)` : ''}. ${r.skipped.length} skipped.`
    })

  return (
    <Page
      route={route}
      title="Link ERP sales orders"
      subtitle="ERP sales orders have no customer or price. Linking gives each one a CRM account and the account's net price, which is what the Actual numbers use. Draft orders are never linked."
      actions={[
        { label: 'Auto-link all', icon: 'link', onClick: runAuto, disabled: !canWrite || s.saving, primary: true, title: 'Link every unlinked order to an account at the same warehouse that buys the SKU' },
        { label: 'Refresh', icon: 'refresh', onClick: () => void Promise.all([loadErp(), reload()]) },
      ]}
    >
      {s.result && (
        <Notice kind={s.result.kind} onClose={() => s.setResult(null)}>
          {s.result.text}
        </Notice>
      )}
      {auto && auto.skipped.length > 0 && (
        <Notice kind="warning" onClose={() => setAuto(null)}>
          Skipped:{' '}
          {auto.skipped
            .slice(0, 8)
            .map((x) => `${x.sales_order_id} (${x.reason})`)
            .join('; ')}
          {auto.skipped.length > 8 ? ` and ${auto.skipped.length - 8} more` : ''}. Link these by hand below if they belong to a customer.
        </Notice>
      )}
      {erpError && <Notice kind="error">{erpError}</Notice>}
      {!erp && !erpError && <Notice kind="loading">Loading ERP sales orders…</Notice>}
      <div className="kpis">
        <div className="kpi">
          <span>ERP sales orders</span>
          <strong>{erp?.length ?? '…'}</strong>
        </div>
        <div className="kpi">
          <span>Linked</span>
          <strong>{data!.orders.length}</strong>
        </div>
        <div className="kpi">
          <span>Waiting to be linked</span>
          <strong>{erp ? unlinked : '…'}</strong>
        </div>
      </div>
      <div className="filter-bar">
        <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Show">
          <option value="unlinked">Unlinked (not drafts)</option>
          <option value="linked">Linked</option>
          <option value="all">All ERP orders</option>
        </select>
      </div>
      <DataGrid<ErpSalesOrder>
        rows={rows}
        rowKey={(o) => o.sales_order_id}
        empty={show === 'unlinked' ? 'Every non-draft ERP order is linked.' : 'No orders.'}
        columns={[
          { key: 'id', header: 'ERP order', render: (o) => <span className="mono">{o.sales_order_id}</span>, sortValue: (o) => o.sales_order_id },
          { key: 'date', header: 'Date', render: (o) => shortDate(o.order_date), sortValue: (o) => o.order_date },
          { key: 'sku', header: 'SKU', render: (o) => <span className="mono">{o.sku}</span>, sortValue: (o) => o.sku },
          { key: 'wh', header: 'Warehouse', render: (o) => <span className="mono">{o.warehouse_id}</span>, sortValue: (o) => o.warehouse_id },
          { key: 'qty', header: 'Qty', render: (o) => o.order_qty ?? '—', numeric: true, sortValue: (o) => o.order_qty },
          { key: 'status', header: 'ERP status', render: (o) => o.status ?? '—', sortValue: (o) => o.status },
          {
            key: 'acc',
            header: 'Customer',
            render: (o) => {
              const l = links.get(o.sales_order_id)
              return l ? <a href={href(`customers/accounts/${l.account_id}`)}>{accountById.get(l.account_id)?.account_name ?? l.account_id}</a> : <StatusBadge text="Not linked" tone="warn" />
            },
            sortValue: (o) => accountById.get(links.get(o.sales_order_id)?.account_id ?? '')?.account_name ?? '',
          },
          { key: 'amt', header: 'Amount', numeric: true, render: (o) => { const l = links.get(o.sales_order_id); return l ? money(l.order_qty * l.unit_price) : '' } },
          { key: 'x', header: '', render: (o) => (isDraft(o) ? <span className="muted small">Draft</span> : <LinkCell order={o} linkedTo={links.get(o.sales_order_id)?.account_id} disabled={!canWrite} />) },
        ]}
      />
    </Page>
  )
}

function LinkCell({ order, linkedTo, disabled }: { order: ErpSalesOrder; linkedTo?: string; disabled: boolean }) {
  const { data, reload } = useCrmData()
  const sameDc = data!.accounts.filter((a) => a.home_warehouse_id === order.warehouse_id)
  const others = data!.accounts.filter((a) => a.home_warehouse_id !== order.warehouse_id)
  const [pick, setPick] = useState(linkedTo ?? sameDc[0]?.account_id ?? others[0]?.account_id ?? '')
  const s = useSubmit()
  const act = (fn: () => Promise<unknown>, msg: string) =>
    void s.run(async () => {
      await fn()
      await reload()
      return msg
    })
  return (
    <span className="row-actions">
      <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={disabled || s.saving} aria-label={`Customer for ${order.sales_order_id}`}>
        {sameDc.length > 0 && (
          <optgroup label={`At ${order.warehouse_id}`}>
            {sameDc.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.account_name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Other warehouses">
          {others.map((a) => (
            <option key={a.account_id} value={a.account_id}>
              {a.account_name}
            </option>
          ))}
        </optgroup>
      </select>
      <button disabled={disabled || s.saving || !pick || pick === linkedTo} onClick={() => act(() => api.linkOrder(order.sales_order_id, pick), 'Linked.')}>
        {linkedTo ? 'Change' : 'Link'}
      </button>
      {linkedTo && (
        <button disabled={disabled || s.saving} onClick={() => act(() => api.unlinkOrder(order.sales_order_id), 'Unlinked.')}>
          Unlink
        </button>
      )}
      {s.result?.kind === 'error' && <span className="tone-bad small">{s.result.text}</span>}
    </span>
  )
}
