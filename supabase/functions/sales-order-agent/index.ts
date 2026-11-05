// Sales order agent: turns a plain-English request into a Draft sales order.
// Claude only picks the customer, SKU, warehouse and quantity using the tools below;
// every write goes through api.agent_create_sales_order with the caller's own sign-in,
// so the database role checks (operator only) still apply. The new order is then
// handed to the approver agent.
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

const SYSTEM = `You are the sales order agent for a uniform and facility-supplies distributor's ERP.
You turn a sales rep's plain-English request into sales orders.
- Always look up the customer with search_customers and the product with list_products. Never invent an account id or SKU.
- If the warehouse is not given, use the customer's home warehouse.
- Run check_stock before creating an order and tell the user the result.
- Create one order per product line with create_sales_order. Orders start as Draft and go to the approver agent automatically.
- If the customer, product or quantity is unclear or matches more than one record, ask a short question instead of creating an order.
- Reply in 2 to 5 short sentences: what you created (order id, customer, SKU, qty, amount), the stock result, and the approver's decision.`

const tools: Anthropic.Tool[] = [
  {
    name: 'search_customers',
    description: 'Find customers by part of the name or account id. Returns account_id, account_name, home_warehouse_id, discount_pct.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    strict: true,
  },
  {
    name: 'list_products',
    description: 'List all products with sku, product_name, category and list_price (USD).',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: 'check_stock',
    description: 'Check stock for a SKU in a warehouse (KY-DC-01, OH-DC-01, TN-DC-01). Returns on_hand, reserved, available and stock_status (Available, Partial, Short).',
    input_schema: {
      type: 'object',
      properties: { sku: { type: 'string' }, warehouse_id: { type: 'string' }, qty: { type: 'integer' } },
      required: ['sku', 'warehouse_id', 'qty'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'create_sales_order',
    description: 'Create one Draft sales order line and send it to the approver agent. Returns the order with amount, stock status and approval decision.',
    input_schema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        sku: { type: 'string' },
        warehouse_id: { type: 'string', description: 'Empty string = customer home warehouse' },
        qty: { type: 'integer' },
      },
      required: ['account_id', 'sku', 'warehouse_id', 'qty'],
      additionalProperties: false,
    },
    strict: true,
  },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    db: { schema: 'api' },
  })
  const { data: role } = await db.rpc('current_erp_role')
  if (role !== 'operator') return json({ error: 'Only ERP operators can use the sales order agent.' }, 403)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set in Supabase Edge Function secrets yet.' }, 503)

  const { message } = await req.json().catch(() => ({ message: '' }))
  if (typeof message !== 'string' || !message.trim()) return json({ error: 'Send { "message": "..." }' }, 400)
  const requestText = message.trim().slice(0, 2000)

  const created: unknown[] = []
  const steps: { tool: string; input: unknown; ok: boolean }[] = []

  async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'search_customers': {
        const q = String(input.query ?? '').replace(/[%,()]/g, ' ').trim()
        const { data, error } = await db.from('customers').select('*').or(`account_name.ilike.%${q}%,account_id.ilike.%${q}%`).limit(10)
        if (error) throw error
        return data
      }
      case 'list_products': {
        const [{ data: products, error: e1 }, { data: prices, error: e2 }] = await Promise.all([
          db.from('products').select('sku, product_name, category'),
          db.from('price_list').select('sku, list_price'),
        ])
        if (e1 || e2) throw e1 ?? e2
        const price = new Map((prices ?? []).map((p) => [p.sku, p.list_price]))
        return (products ?? []).map((p) => ({ ...p, list_price: price.get(p.sku) ?? null }))
      }
      case 'check_stock': {
        const { data, error } = await db.rpc('check_stock', { p_sku: input.sku, p_warehouse_id: input.warehouse_id, p_qty: input.qty })
        if (error) throw error
        return data
      }
      case 'create_sales_order': {
        const { data, error } = await db.rpc('agent_create_sales_order', {
          p_account_id: input.account_id,
          p_sku: input.sku,
          p_warehouse_id: input.warehouse_id,
          p_order_qty: input.qty,
          p_request_text: requestText,
          p_requested_by: 'Sales order agent',
        })
        if (error) throw error
        // Hand over to the approver agent (a separate Edge Function).
        const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/approver-agent`, {
          method: 'POST',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sales_order_id: data.sales_order_id }),
        })
        const review = await res.json().catch(() => ({ error: `approver returned ${res.status}` }))
        const result = { order: data, approval: review }
        created.push(result)
        return result
      }
      default:
        throw new Error(`Unknown tool ${name}`)
    }
  }

  const client = new Anthropic({ apiKey })
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: requestText }]
  let reply = ''
  try {
    for (let turn = 0; turn < 10; turn++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        tools,
        messages,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as Anthropic.Beta.MessageCreateParamsNonStreaming)
      messages.push({ role: 'assistant', content: response.content })
      if (response.stop_reason === 'refusal') { reply = 'The agent declined this request.'; break }
      if (response.stop_reason !== 'tool_use') {
        reply = response.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim()
        break
      }
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        try {
          const out = await runTool(block.name, (block.input ?? {}) as Record<string, unknown>)
          steps.push({ tool: block.name, input: block.input, ok: true })
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) })
        } catch (e) {
          const msg = (e as { message?: string }).message ?? String(e)
          steps.push({ tool: block.name, input: block.input, ok: false })
          results.push({ type: 'tool_result', tool_use_id: block.id, content: msg, is_error: true })
        }
      }
      messages.push({ role: 'user', content: results })
    }
  } catch (e) {
    if (e instanceof Anthropic.APIError) return json({ error: `Claude API error ${e.status}: ${e.message}`, created, steps }, 502)
    return json({ error: (e as Error).message, created, steps }, 500)
  }
  return json({ reply: reply || 'Done.', created, steps })
})
