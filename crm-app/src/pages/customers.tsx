// Customers: accounts (list, record page, new), contacts and activities.
import { useState, type ReactNode } from 'react'
import { Notice } from '../components/Notice'
import { RecordForm, toValues } from '../components/RecordForm'
import { StatusBadge } from '../components/StatusBadge'
import { useCrmData } from '../data/CrmData'
import { api } from '../lib/api'
import { money, qty, shortDate, today } from '../lib/format'
import { weightedAmount } from '../lib/plan'
import { href, navigate } from '../lib/router'
import type { Account, Activity, Contact, Opportunity } from '../lib/types'
import { DataGrid, FastTab, Page } from '../shell/Page'
import { useSubmit } from '../shell/useSubmit'
import { accountFields, activityFields, contactFields, opportunityFields } from './fields'

type P = { route: string; canWrite: boolean }

const statusTone = (s: string) => (s === 'Active' ? 'good' : s === 'Prospect' ? 'neutral' : s === 'On Hold' ? 'warn' : 'bad')
const stageTone = (s: string) => (s === 'Closed Won' ? 'good' : s === 'Closed Lost' ? 'bad' : s === 'Negotiation' ? 'warn' : 'neutral')

export function AccountsPage({ route, canWrite }: P) {
  const { data, loading, reload } = useCrmData()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const orders = data!.orders
  const rows = data!.accounts.filter(
    (a) => (!status || a.account_status === status) && (!q.trim() || `${a.account_id} ${a.account_name} ${a.industry} ${a.billing_city} ${a.account_owner}`.toLowerCase().includes(q.trim().toLowerCase())),
  )
  return (
    <Page
      route={route}
      title="Accounts"
      actions={[
        { label: 'New', icon: 'plus', to: 'customers/new', disabled: !canWrite, primary: true },
        { label: 'Refresh', icon: 'refresh', onClick: () => void reload(), disabled: loading },
      ]}
    >
      <div className="filter-bar">
        <input type="search" placeholder="Filter accounts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter accounts" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {['Prospect', 'Active', 'On Hold', 'Inactive'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <DataGrid<Account>
        rows={rows}
        rowKey={(a) => a.account_id}
        onSelect={(a) => navigate(`customers/accounts/${a.account_id}`)}
        columns={[
          { key: 'id', header: 'Account', render: (a) => <span className="mono">{a.account_id}</span>, sortValue: (a) => a.account_id },
          { key: 'name', header: 'Name', render: (a) => <a href={href(`customers/accounts/${a.account_id}`)}>{a.account_name}</a>, sortValue: (a) => a.account_name },
          { key: 'status', header: 'Status', render: (a) => <StatusBadge text={a.account_status} tone={statusTone(a.account_status)} />, sortValue: (a) => a.account_status },
          { key: 'seg', header: 'Segment', render: (a) => a.segment, sortValue: (a) => a.segment },
          { key: 'ind', header: 'Industry', render: (a) => a.industry ?? '—', sortValue: (a) => a.industry },
          { key: 'city', header: 'City', render: (a) => [a.billing_city, a.billing_state].filter(Boolean).join(', ') || '—', sortValue: (a) => a.billing_city },
          { key: 'wh', header: 'Warehouse', render: (a) => <span className="mono">{a.home_warehouse_id ?? '—'}</span>, sortValue: (a) => a.home_warehouse_id },
          { key: 'owner', header: 'Owner', render: (a) => a.account_owner ?? '—', sortValue: (a) => a.account_owner },
          {
            key: 'sales',
            header: 'Actual sales',
            numeric: true,
            render: (a) => money(orders.filter((o) => o.account_id === a.account_id).reduce((s, o) => s + o.order_qty * o.unit_price, 0)),
            sortValue: (a) => orders.filter((o) => o.account_id === a.account_id).reduce((s, o) => s + o.order_qty * o.unit_price, 0),
          },
        ]}
      />
    </Page>
  )
}

export function NewAccountPage({ route, canWrite }: P) {
  const { reload } = useCrmData()
  return (
    <Page route={route} title="New account" subtitle="The account number (ACC-…) is set by the database." actions={[{ label: 'Accounts', icon: 'list', to: 'customers/accounts' }]}>
      {!canWrite && <Notice kind="info">Your account is read-only.</Notice>}
      <RecordForm
        fields={accountFields}
        initial={toValues(accountFields, { segment: 'Mid-Market', account_status: 'Prospect', discount_pct: 0 })}
        disabled={!canWrite}
        resetAfterSave
        onSave={async (body) => {
          const a = await api.save<Account>('accounts', body)
          await reload()
          navigate(`customers/accounts/${a.account_id}`)
          return `Account ${a.account_id} created.`
        }}
      />
    </Page>
  )
}

export function AccountPage({ route, canWrite, accountId }: P & { accountId: string }) {
  const { data, reload, accountById } = useCrmData()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState<'' | 'contact' | 'opportunity' | 'activity'>('')
  const del = useSubmit()
  const a = accountById.get(accountId)
  if (!a) {
    return (
      <Page route={route} title="Account not found">
        <Notice kind="warning">
          {accountId} does not exist or was deleted. <a href={href('customers/accounts')}>Back to accounts</a>
        </Notice>
      </Page>
    )
  }
  const contacts = data!.contacts.filter((c) => c.account_id === a.account_id)
  const opps = data!.opportunities.filter((o) => o.account_id === a.account_id)
  const acts = data!.activities.filter((x) => x.account_id === a.account_id)
  const orders = data!.orders.filter((o) => o.account_id === a.account_id)
  const forecasts = data!.forecasts.filter((f) => f.account_id === a.account_id)
  const accountsOnly = [a]

  const remove = () => {
    if (!window.confirm(`Delete ${a.account_name}? It is kept as a deleted record so reports stay correct.`)) return
    void del.run(async () => {
      await api.remove('accounts', a.account_id)
      await reload()
      navigate('customers/accounts')
      return 'Deleted.'
    })
  }

  return (
    <Page
      route={route}
      title={a.account_name}
      subtitle={
        <>
          <span className="mono">{a.account_id}</span> · {a.segment} · <StatusBadge text={a.account_status} tone={statusTone(a.account_status)} />
        </>
      }
      actions={[
        { label: 'Edit', icon: 'edit', onClick: () => setEditing(!editing), disabled: !canWrite, primary: true },
        { label: 'New contact', icon: 'contact', onClick: () => setAdding('contact'), disabled: !canWrite },
        { label: 'New opportunity', icon: 'opportunity', onClick: () => setAdding('opportunity'), disabled: !canWrite },
        { label: 'Log activity', icon: 'activity', onClick: () => setAdding('activity'), disabled: !canWrite },
        { label: 'Delete', icon: 'trash', onClick: remove, disabled: !canWrite || del.saving },
      ]}
    >
      {del.result?.kind === 'error' && (
        <Notice kind="error" onClose={() => del.setResult(null)}>
          {del.result.text}
        </Notice>
      )}
      {editing ? (
        <RecordForm
          fields={accountFields}
          initial={toValues(accountFields, a as unknown as Record<string, unknown>)}
          onCancel={() => setEditing(false)}
          onSave={async (body) => {
            await api.save('accounts', body, a.account_id)
            await reload()
            setEditing(false)
            return 'Saved.'
          }}
        />
      ) : (
        <FastTab title="Account details">
          <dl className="facts">
            <Fact label="Industry" value={a.industry} />
            <Fact label="Owner" value={a.account_owner} />
            <Fact label="Serving warehouse" value={a.home_warehouse_id} />
            <Fact label="Discount" value={`${a.discount_pct}%`} />
            <Fact label="City" value={[a.billing_city, a.billing_state].filter(Boolean).join(', ')} />
            <Fact label="Phone" value={a.phone} />
            <Fact label="Website" value={a.website && <a href={a.website} target="_blank" rel="noreferrer">{a.website}</a>} />
            <Fact label="Last changed" value={shortDate(a.updated_at)} />
          </dl>
        </FastTab>
      )}

      {adding === 'contact' && (
        <RecordForm
          title="New contact"
          fields={contactFields(accountsOnly)}
          initial={toValues(contactFields(accountsOnly), { account_id: a.account_id, is_primary: contacts.length === 0 })}
          onCancel={() => setAdding('')}
          onSave={async (body) => {
            const c = await api.save<Contact>('contacts', body)
            await reload()
            setAdding('')
            return `Contact ${c.contact_id} added.`
          }}
        />
      )}
      {adding === 'opportunity' && (
        <RecordForm
          title="New opportunity"
          fields={opportunityFields(accountsOnly)}
          initial={toValues(opportunityFields(accountsOnly), { account_id: a.account_id, stage: 'Prospecting', probability_pct: 10, owner: a.account_owner })}
          onCancel={() => setAdding('')}
          onSave={async (body) => {
            const o = await api.save<Opportunity>('opportunities', body)
            await reload()
            setAdding('')
            return `Opportunity ${o.opportunity_id} added.`
          }}
        />
      )}
      {adding === 'activity' && (
        <RecordForm
          title="Log activity"
          fields={activityFields(accountsOnly)}
          initial={toValues(activityFields(accountsOnly), { account_id: a.account_id, activity_type: 'Call', due_date: today() })}
          onCancel={() => setAdding('')}
          onSave={async (body) => {
            const x = await api.save<Activity>('activities', body)
            await reload()
            setAdding('')
            return `Activity ${x.activity_id} logged.`
          }}
        />
      )}

      <FastTab title={`Contacts (${contacts.length})`}>
        <DataGrid<Contact>
          rows={contacts}
          rowKey={(c) => c.contact_id}
          empty="No contacts yet."
          columns={[
            { key: 'name', header: 'Name', render: (c) => `${c.first_name} ${c.last_name}${c.is_primary ? ' ★' : ''}` },
            { key: 'title', header: 'Title', render: (c) => c.title ?? '—' },
            { key: 'email', header: 'Email', render: (c) => (c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—') },
            { key: 'phone', header: 'Phone', render: (c) => c.phone ?? '—' },
            { key: 'x', header: '', render: (c) => <DeleteButton entity="contacts" id={c.contact_id} disabled={!canWrite} /> },
          ]}
        />
      </FastTab>
      <FastTab title={`Opportunities (${opps.length})`} summary={money(opps.reduce((s, o) => s + weightedAmount(o), 0)) + ' weighted'}>
        <OpportunityGrid rows={opps} canWrite={canWrite} />
      </FastTab>
      <FastTab title={`Activities (${acts.length})`}>
        <ActivityGrid rows={acts} canWrite={canWrite} />
      </FastTab>
      <FastTab title={`ERP sales orders (${orders.length})`} summary={money(orders.reduce((s, o) => s + o.order_qty * o.unit_price, 0))} defaultOpen={false}>
        <DataGrid
          rows={orders}
          rowKey={(o) => o.erp_sales_order_id}
          empty="No ERP orders linked to this account yet."
          columns={[
            { key: 'id', header: 'ERP order', render: (o) => <span className="mono">{o.erp_sales_order_id}</span>, sortValue: (o) => o.erp_sales_order_id },
            { key: 'date', header: 'Date', render: (o) => shortDate(o.order_date), sortValue: (o) => o.order_date },
            { key: 'sku', header: 'SKU', render: (o) => <span className="mono">{o.sku}</span>, sortValue: (o) => o.sku },
            { key: 'qty', header: 'Qty', render: (o) => qty(o.order_qty), numeric: true, sortValue: (o) => o.order_qty },
            { key: 'price', header: 'Unit price', render: (o) => o.unit_price.toFixed(2), numeric: true },
            { key: 'amt', header: 'Amount', render: (o) => money(o.order_qty * o.unit_price), numeric: true, sortValue: (o) => o.order_qty * o.unit_price },
          ]}
        />
      </FastTab>
      <FastTab title="Demand forecast" summary={`${qty(forecasts.reduce((s, f) => s + f.forecast_qty, 0))} units`} defaultOpen={false}>
        <p>
          <a href={href(`planning/demand`)}>Open the demand forecast grid</a> to change this account's monthly quantities.
        </p>
      </FastTab>
    </Page>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || '—'}</dd>
    </div>
  )
}

export function DeleteButton({ entity, id, disabled }: { entity: 'contacts' | 'opportunities' | 'activities'; id: string; disabled?: boolean }) {
  const { reload } = useCrmData()
  const s = useSubmit()
  return (
    <span className="row-actions">
      <button
        type="button"
        disabled={disabled || s.saving}
        title="Delete"
        onClick={() => {
          if (!window.confirm(`Delete ${id}?`)) return
          void s.run(async () => {
            await api.remove(entity, id)
            await reload()
            return 'Deleted.'
          })
        }}
      >
        Delete
      </button>
      {s.result?.kind === 'error' && <span className="tone-bad small">{s.result.text}</span>}
    </span>
  )
}

export function OpportunityGrid({ rows, canWrite, showAccount }: { rows: Opportunity[]; canWrite: boolean; showAccount?: boolean }) {
  const { accountById } = useCrmData()
  return (
    <DataGrid<Opportunity>
      rows={rows}
      rowKey={(o) => o.opportunity_id}
      empty="No opportunities."
      columns={[
        { key: 'id', header: 'ID', render: (o) => <span className="mono">{o.opportunity_id}</span>, sortValue: (o) => o.opportunity_id },
        ...(showAccount
          ? [{ key: 'acc', header: 'Account', render: (o: Opportunity) => <a href={href(`customers/accounts/${o.account_id}`)}>{accountById.get(o.account_id)?.account_name ?? o.account_id}</a>, sortValue: (o: Opportunity) => accountById.get(o.account_id)?.account_name ?? '' }]
          : []),
        { key: 'name', header: 'Opportunity', render: (o) => o.opportunity_name, sortValue: (o) => o.opportunity_name },
        { key: 'stage', header: 'Stage', render: (o) => <StatusBadge text={o.stage} tone={stageTone(o.stage)} />, sortValue: (o) => o.stage },
        { key: 'amt', header: 'Amount', render: (o) => money(o.amount), numeric: true, sortValue: (o) => o.amount },
        { key: 'prob', header: 'Prob.', render: (o) => `${o.probability_pct}%`, numeric: true, sortValue: (o) => o.probability_pct },
        { key: 'close', header: 'Close date', render: (o) => shortDate(o.close_date), sortValue: (o) => o.close_date },
        { key: 'owner', header: 'Owner', render: (o) => o.owner ?? '—', sortValue: (o) => o.owner },
        { key: 'next', header: 'Next step', render: (o) => o.next_step ?? '—' },
        { key: 'x', header: '', render: (o) => <StageButtons o={o} disabled={!canWrite} /> },
      ]}
    />
  )
}

const NEXT_STAGE: Record<string, string> = { Prospecting: 'Qualification', Qualification: 'Proposal', Proposal: 'Negotiation', Negotiation: 'Closed Won' }
const STAGE_PROB: Record<string, number> = { Qualification: 25, Proposal: 50, Negotiation: 75, 'Closed Won': 100, 'Closed Lost': 0 }

function StageButtons({ o, disabled }: { o: Opportunity; disabled: boolean }) {
  const { reload } = useCrmData()
  const s = useSubmit()
  const move = (stage: string) =>
    void s.run(async () => {
      await api.save('opportunities', { stage, probability_pct: STAGE_PROB[stage] }, o.opportunity_id)
      await reload()
      return `Moved to ${stage}.`
    })
  if (o.stage.startsWith('Closed')) return <DeleteButton entity="opportunities" id={o.opportunity_id} disabled={disabled} />
  return (
    <span className="row-actions">
      <button type="button" disabled={disabled || s.saving} onClick={() => move(NEXT_STAGE[o.stage])} title={`Move to ${NEXT_STAGE[o.stage]}`}>
        → {NEXT_STAGE[o.stage]}
      </button>
      <button type="button" disabled={disabled || s.saving} onClick={() => move('Closed Lost')}>
        Lost
      </button>
      {s.result?.kind === 'error' && <span className="tone-bad small">{s.result.text}</span>}
    </span>
  )
}

export function ActivityGrid({ rows, canWrite, showAccount }: { rows: Activity[]; canWrite: boolean; showAccount?: boolean }) {
  const { accountById, reload } = useCrmData()
  const s = useSubmit()
  const now = today()
  return (
    <>
      {s.result?.kind === 'error' && <Notice kind="error">{s.result.text}</Notice>}
      <DataGrid<Activity>
        rows={rows}
        rowKey={(x) => x.activity_id}
        empty="No activities."
        columns={[
          { key: 'due', header: 'Due', render: (x) => <span className={!x.is_done && x.due_date && x.due_date < now ? 'tone-bad' : undefined}>{shortDate(x.due_date)}</span>, sortValue: (x) => x.due_date },
          { key: 'type', header: 'Type', render: (x) => x.activity_type, sortValue: (x) => x.activity_type },
          { key: 'subject', header: 'Subject', render: (x) => x.subject, sortValue: (x) => x.subject },
          ...(showAccount
            ? [{ key: 'acc', header: 'Account', render: (x: Activity) => <a href={href(`customers/accounts/${x.account_id}`)}>{accountById.get(x.account_id)?.account_name ?? x.account_id}</a>, sortValue: (x: Activity) => accountById.get(x.account_id)?.account_name ?? '' }]
            : []),
          {
            key: 'done',
            header: 'Done',
            render: (x) => (
              <input
                type="checkbox"
                checked={x.is_done}
                disabled={!canWrite || s.saving}
                aria-label="Done"
                onChange={(e) =>
                  void s.run(async () => {
                    await api.save('activities', { is_done: e.target.checked }, x.activity_id)
                    await reload()
                    return 'Saved.'
                  })
                }
              />
            ),
            sortValue: (x) => (x.is_done ? 1 : 0),
          },
          { key: 'x', header: '', render: (x) => <DeleteButton entity="activities" id={x.activity_id} disabled={!canWrite} /> },
        ]}
      />
    </>
  )
}

export function ContactsPage({ route, canWrite }: P) {
  const { data, accountById } = useCrmData()
  const [q, setQ] = useState('')
  const rows = data!.contacts.filter((c) => !q.trim() || `${c.first_name} ${c.last_name} ${c.email} ${c.title} ${accountById.get(c.account_id)?.account_name}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <Page route={route} title="Contacts" subtitle="Add contacts from the account page.">
      <div className="filter-bar">
        <input type="search" placeholder="Filter contacts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter contacts" />
      </div>
      <DataGrid<Contact>
        rows={rows}
        rowKey={(c) => c.contact_id}
        columns={[
          { key: 'name', header: 'Name', render: (c) => `${c.first_name} ${c.last_name}${c.is_primary ? ' ★' : ''}`, sortValue: (c) => `${c.last_name} ${c.first_name}` },
          { key: 'acc', header: 'Account', render: (c) => <a href={href(`customers/accounts/${c.account_id}`)}>{accountById.get(c.account_id)?.account_name ?? c.account_id}</a>, sortValue: (c) => accountById.get(c.account_id)?.account_name ?? '' },
          { key: 'title', header: 'Title', render: (c) => c.title ?? '—', sortValue: (c) => c.title },
          { key: 'email', header: 'Email', render: (c) => (c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—') },
          { key: 'phone', header: 'Phone', render: (c) => c.phone ?? '—' },
          { key: 'x', header: '', render: (c) => <DeleteButton entity="contacts" id={c.contact_id} disabled={!canWrite} /> },
        ]}
      />
    </Page>
  )
}

export function ActivitiesPage({ route, canWrite }: P) {
  const { data, reload } = useCrmData()
  const [showDone, setShowDone] = useState(false)
  const [adding, setAdding] = useState(false)
  const rows = data!.activities.filter((a) => showDone || !a.is_done)
  const fields = activityFields(data!.accounts)
  return (
    <Page route={route} title="Activities" actions={[{ label: 'New activity', icon: 'plus', onClick: () => setAdding(true), disabled: !canWrite, primary: true }]}>
      {adding && (
        <RecordForm
          title="New activity"
          fields={fields}
          initial={toValues(fields, { activity_type: 'Call', due_date: today() })}
          onCancel={() => setAdding(false)}
          onSave={async (body) => {
            const x = await api.save<Activity>('activities', body)
            await reload()
            setAdding(false)
            return `Activity ${x.activity_id} logged.`
          }}
        />
      )}
      <div className="filter-bar">
        <label className="inline-field">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed
        </label>
      </div>
      <ActivityGrid rows={rows} canWrite={canWrite} showAccount />
    </Page>
  )
}
