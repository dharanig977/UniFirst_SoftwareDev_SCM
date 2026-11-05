// Approver agent: reviews Pending sales orders.
// The decision comes from fixed database rules (api.auto_review_sales_order):
//   stock available and amount <= limit -> Approved; otherwise -> Needs Approval (a person decides).
// Claude only writes a short explanation for the reviewer. It cannot change the decision.
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'

const MODEL = 'claude-opus-5-5'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function explain(apiKey: string, order: Record<string, unknown>): Promise<string | null> {
  const client = new Anthropic({ apiKey })
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system:
        'You are the approver agent in an ERP. The approval decision has already been made by fixed business rules. ' +
        'Write 1 or 2 plain sentences for the sales manager explaining the decision and, if a person must decide, what to check ' +
        '(for example: stock shortfall and when it may be replenished, or the order value). Do not change or question the decision. No markdown.',
      messages: [{ role: 'user', content: JSON.stringify(order) }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming)
    if (response.stop_reason === 'refusal') return null
    return response.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ').trim() || null
  } catch (e) {
    console.error('explanation failed', e)
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    db: { schema: 'api' },
  })
  const { data: role } = await db.rpc('current_erp_role')
  if (role !== 'operator') return json({ error: 'Only ERP operators can run the approver agent.' }, 403)

  const body = await req.json().catch(() => ({}))
  let ids: string[] = []
  if (typeof body.sales_order_id === 'string') ids = [body.sales_order_id]
  else if (body.review_pending) {
    const { data, error } = await db.from('sales_order_approvals').select('sales_order_id').eq('approval_status', 'Pending')
    if (error) return json({ error: error.message }, 500)
    ids = (data ?? []).map((r) => r.sales_order_id)
  } else return json({ error: 'Send { "sales_order_id": "SO-..." } or { "review_pending": true }' }, 400)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  const results = []
  for (const id of ids) {
    const { data: ext, error } = await db.rpc('auto_review_sales_order', { p_sales_order_id: id, p_explanation: null })
    if (error) { results.push({ sales_order_id: id, error: error.message }); continue }
    let ai_explanation: string | null = null
    if (apiKey) {
      const { data: row } = await db.from('sales_order_approvals').select('*').eq('sales_order_id', id).single()
      ai_explanation = await explain(apiKey, row ?? ext)
      if (ai_explanation) await db.rpc('add_review_explanation', { p_sales_order_id: id, p_explanation: ai_explanation })
    }
    results.push({ sales_order_id: id, approval_status: ext.approval_status, decision_reason: ext.decision_reason, amount: ext.amount, stock_status: ext.stock_status, ai_explanation })
  }
  return json(ids.length === 1 && typeof body.sales_order_id === 'string' ? results[0] : { results })
})
