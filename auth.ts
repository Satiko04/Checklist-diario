// src/lib/auth.ts
// Funções de autenticação: hash de senha, JWT, verificação de sessão

import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { queryOne } from './db'

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET!)
const COOKIE  = 'checklist_session'
const EXPIRES  = 60 * 60 * 24 * 7 // 7 dias em segundos

// ── Senha ──────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ── JWT ────────────────────────────────────────────────────────

export async function createToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${EXPIRES}s`)
    .sign(SECRET)
}

export async function verifyToken(token: string): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as { sub: string }
  } catch {
    return null
  }
}

// ── Sessão via cookie ──────────────────────────────────────────

export function setSessionCookie(token: string) {
  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   EXPIRES,
    path:     '/',
  })
}

export function clearSessionCookie() {
  cookies().delete(COOKIE)
}

// ── Usuário atual ──────────────────────────────────────────────

export interface SessionUser {
  id:    string
  name:  string
  email: string
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE)?.value
  if (!token) return null

  const payload = await verifyToken(token)
  if (!payload?.sub) return null

  const user = await queryOne<SessionUser>(
    'SELECT id, name, email FROM users WHERE id = $1',
    [payload.sub]
  )
  return user
}

/** Middleware helper: lança erro 401 se não autenticado */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error('UNAUTHORIZED')
  return user
}
