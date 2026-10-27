// The one place the server connects to the CRM database.
// Aiven's free plan allows 20 connections in total, so each serverless
// instance keeps at most 2 and lets idle ones go quickly.
import pg from 'pg'
import { ConfigError, type ServerConfig } from './config.js'

// Return DATE columns as 'YYYY-MM-DD' text, not JS Dates shifted by time zone,
// and NUMERIC as numbers (values here are prices and quantities, well within range).
pg.types.setTypeParser(1082, (v) => v)
pg.types.setTypeParser(1700, (v) => Number(v))
pg.types.setTypeParser(20, (v) => Number(v))

export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>

let pool: pg.Pool | null = null

export function sslOptions(url: string, ca: string | null): pg.PoolConfig['ssl'] {
  const host = new URL(url).hostname
  if (host === 'localhost' || host === '127.0.0.1') return false
  if (!ca) throw new ConfigError('Server setup: CRM_DATABASE_CA is not set. Paste the CA certificate from Aiven (service Overview > CA certificate) into Vercel.')
  return { ca, rejectUnauthorized: true }
}

export function getPool(cfg: ServerConfig): pg.Pool {
  if (!pool) {
    const url = new URL(cfg.databaseUrl)
    // sslmode in the URL would override the ssl object below, so TLS is set only here.
    url.searchParams.delete('sslmode')
    pool = new pg.Pool({
      connectionString: url.toString(),
      ssl: sslOptions(cfg.databaseUrl, cfg.databaseCa),
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    })
  }
  return pool
}

export function queryWith(p: pg.Pool): Query {
  return async (sql, params = []) => (await p.query(sql, params)).rows
}

/** Runs fn inside one transaction on one connection. */
export async function transaction<T>(p: pg.Pool, fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await p.connect()
  try {
    await client.query('begin')
    const result = await fn(async (sql, params = []) => (await client.query(sql, params)).rows)
    await client.query('commit')
    return result
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}
