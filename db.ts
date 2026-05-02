// src/lib/db.ts
// Conexão singleton com o PostgreSQL usando pool de conexões

import { Pool, PoolClient } from 'pg'

declare global {
  var _pgPool: Pool | undefined
}

function createPool(): Pool {
  return new Pool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max:               20,   // máximo de conexões no pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  })
}

// Em desenvolvimento, reutiliza o pool entre hot-reloads do Next.js
const pool = globalThis._pgPool ?? createPool()
if (process.env.NODE_ENV !== 'production') globalThis._pgPool = pool

export default pool

// ── Helpers ────────────────────────────────────────────────────

/** Executa uma query simples */
export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  const { rows } = await pool.query(text, params)
  return rows as T[]
}

/** Executa uma query e retorna apenas a primeira linha */
export async function queryOne<T = any>(
  text: string,
  params?: any[]
): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}

/** Executa múltiplas queries dentro de uma transação */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
