// Opportunities: pipeline board by stage, and a new-opportunity form.
import { useState } from 'react'
import { Notice } from '../components/Notice'
import { RecordForm, toValues } from '../components/RecordForm'
import { useCrmData } from '../data/CrmData'
import { api } from '../lib/api'
import { money, shortDate } from '../lib/format'
import { weightedAmount } from '../lib/plan'
import { href, navigate } from '../lib/router'
import { STAGES, type Opportunity } from '../lib/types'
import { Page } from '../shell/Page'
import { OpportunityGrid } from './customers'
import { opportunityFields } from './fields'

type P = { route: string; canWrite: boolean }

export function PipelinePage({ route, canWrite }: P) {
  const { data, accountById, loading, reload } = useCrmData()
  const [view, setView] = useState<'board' | 'list'>('board')
  const [owner, setOwner] = useState('')
  const owners = [...new Set(data!.opportunities.map((o) => o.owner).filter(Boolean))] as string[]
  const opps = data!.opportunities.filter((o) => !owner || o.owner === owner)
  const open = opps.filter((o) => !o.stage.startsWith('Closed'))
  return (
    <Page
      route={route}
      title="Pipeline"
      subtitle={`${open.length} open · ${money(open.reduce((s, o) => s + o.amount, 0))} · ${money(open.reduce((s, o) => s + weightedAmount(o), 0))} weighted`}
      actions={[
        { label: 'New', icon: 'plus', to: 'sales/new', disabled: !canWrite, primary: true },
        { label: view === 'board' ? 'List view' : 'Board view', icon: 'list', onClick: () => setView(view === 'board' ? 'list' : 'board') },
        { label: 'Refresh', icon: 'refresh', onClick: () => void reload(), disabled: loading },
      ]}
    >
      <div className="filter-bar">
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">All owners</option>
          {owners.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>
      {view === 'list' ? (
        <OpportunityGrid rows={opps} canWrite={canWrite} showAccount />
      ) : (
        <div className="pipeline">
          {STAGES.map((stage) => {
            const col = opps.filter((o) => o.stage === stage)
            return (
              <section key={stage} className="pipeline-col">
                <h3>
                  {stage} <span>{money(col.reduce((s, o) => s + o.amount, 0))}</span>
                </h3>
                {col.map((o: Opportunity) => (
                  <div key={o.opportunity_id} className="opp-card">
                    <strong>{o.opportunity_name}</strong>
                    <a href={href(`customers/accounts/${o.account_id}`)}>{accountById.get(o.account_id)?.account_name ?? o.account_id}</a>
                    <span>
                      {money(o.amount)} · {o.probability_pct}%
                    </span>
                    <span className="muted small">Close {shortDate(o.close_date)}</span>
                  </div>
                ))}
              </section>
            )
          })}
        </div>
      )}
    </Page>
  )
}

export function NewOpportunityPage({ route, canWrite }: P) {
  const { data, reload } = useCrmData()
  const fields = opportunityFields(data!.accounts)
  return (
    <Page route={route} title="New opportunity" actions={[{ label: 'Pipeline', icon: 'list', to: 'sales/pipeline' }]}>
      {!canWrite && <Notice kind="info">Your account is read-only.</Notice>}
      <RecordForm
        fields={fields}
        initial={toValues(fields, { stage: 'Prospecting', probability_pct: 10 })}
        disabled={!canWrite}
        resetAfterSave
        onSave={async (body) => {
          const o = await api.save<Opportunity>('opportunities', body)
          await reload()
          navigate(`customers/accounts/${o.account_id}`)
          return `Opportunity ${o.opportunity_id} created.`
        }}
      />
    </Page>
  )
}
