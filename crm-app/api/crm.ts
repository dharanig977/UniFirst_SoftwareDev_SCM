// The CRM's only server endpoint: /api/crm?r=<action>. Runs as a Vercel
// Function, so the database password never reaches the browser.
import { verifyUser } from './_lib/auth.js'
import { readConfig } from './_lib/config.js'
import { getPool, queryWith, transaction } from './_lib/db.js'
import { erpOrderReader } from './_lib/erp.js'
import { errorResponse, handle } from './_lib/handlers.js'

async function run(req: Request): Promise<Response> {
  try {
    const cfg = readConfig()
    const pool = getPool(cfg)
    return await handle(req, {
      query: queryWith(pool),
      tx: (fn) => transaction(pool, fn),
      verify: (h) => verifyUser(cfg, h),
      erpOrders: erpOrderReader(cfg),
    })
  } catch (e) {
    return errorResponse(e)
  }
}

export const GET = run
export const POST = run
