// Sends queued ERP e-mails (shortage alerts, weekly sales report) through Resend.
// Called every 5 minutes by pg_cron (x-cron-secret header, checked against Supabase Vault)
// or by a signed-in ERP operator from the app ("Send now").
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: 'api' } })

  // Who is calling?
  let allowed = false
  const secret = req.headers.get('x-cron-secret')
  if (secret) {
    const { data } = await service.rpc('verify_cron_secret', { p_secret: secret })
    allowed = data === true
  } else if (req.headers.get('Authorization')) {
    const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
      db: { schema: 'api' },
    })
    const { data: role } = await user.rpc('current_erp_role')
    allowed = role === 'operator'
  }
  if (!allowed) return json({ error: 'Not allowed' }, 403)

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'RESEND_API_KEY is not set in Supabase Edge Function secrets yet.' }, 503)

  const { data: queue, error } = await service.rpc('claim_notifications')
  if (error) return json({ error: error.message }, 500)

  const results = []
  for (const n of queue ?? []) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: n.sender || 'ERP Alerts <onboarding@resend.dev>',
        to: String(n.recipient).split(/[;,]/).map((s: string) => s.trim()).filter(Boolean),
        subject: n.subject,
        html: n.body_html,
      }),
    })
    const text = await res.text()
    await service.rpc('mark_notification', { p_notification_id: n.notification_id, p_sent: res.ok, p_error: res.ok ? null : `${res.status} ${text}` })
    results.push({ notification_id: n.notification_id, kind: n.kind, sent: res.ok, ...(res.ok ? {} : { error: `${res.status} ${text.slice(0, 200)}` }) })
  }
  return json({ sent: results.filter((r) => r.sent).length, results })
})
