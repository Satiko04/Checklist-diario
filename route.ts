// src/app/api/auth/route.ts
// POST /api/auth?action=register|login|logout

import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, withTransaction } from '@/lib/db'
import {
  hashPassword, verifyPassword,
  createToken, setSessionCookie, clearSessionCookie
} from '@/lib/auth'

export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action')

  try {
    if (action === 'register') return await register(req)
    if (action === 'login')    return await login(req)
    if (action === 'logout')   return logout()
    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
  } catch (err: any) {
    console.error('[auth]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// ── Registro ───────────────────────────────────────────────────

async function register(req: NextRequest) {
  const { name, email, password } = await req.json()

  if (!name || !email || !password)
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })

  if (password.length < 8)
    return NextResponse.json({ error: 'Senha deve ter ao menos 8 caracteres' }, { status: 400 })

  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email])
  if (existing)
    return NextResponse.json({ error: 'E-mail já cadastrado' }, { status: 409 })

  const hash = await hashPassword(password)

  const user = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email`,
      [name, email, hash]
    )
    return rows[0]
  })

  const token = await createToken(user.id)
  setSessionCookie(token)

  return NextResponse.json({ user }, { status: 201 })
}

// ── Login ──────────────────────────────────────────────────────

async function login(req: NextRequest) {
  const { email, password } = await req.json()

  if (!email || !password)
    return NextResponse.json({ error: 'E-mail e senha são obrigatórios' }, { status: 400 })

  const user = await queryOne<{
    id: string; name: string; email: string; password_hash: string
  }>('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email])

  if (!user || !(await verifyPassword(password, user.password_hash)))
    return NextResponse.json({ error: 'E-mail ou senha incorretos' }, { status: 401 })

  // Atualiza last_login_at
  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id])

  const token = await createToken(user.id)
  setSessionCookie(token)

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email }
  })
}

// ── Logout ─────────────────────────────────────────────────────

function logout() {
  clearSessionCookie()
  return NextResponse.json({ ok: true })
}
