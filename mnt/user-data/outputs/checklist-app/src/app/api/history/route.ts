// src/app/api/history/route.ts
// GET    /api/history?limit=20&offset=0   → lista histórico do usuário
// DELETE /api/history?id=<uuid>           → apaga uma entrada

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const user  = await requireAuth()
    const limit  = Math.min(parseInt(req.nextUrl.searchParams.get('limit')  || '20'), 100)
    const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0')

    const rows = await query(
      `SELECT
         h.id,
         h.saved_at,
         h.change_type,
         h.snapshot,
         c.date AS checklist_date
       FROM checklist_history h
       JOIN checklists c ON c.id = h.checklist_id
       WHERE h.user_id = $1
       ORDER BY h.saved_at DESC
       LIMIT $2 OFFSET $3`,
      [user.id, limit, offset]
    )

    const total = await queryOne<{ count: string }>(
      'SELECT COUNT(*)::text FROM checklist_history WHERE user_id = $1',
      [user.id]
    )

    return NextResponse.json({
      history: rows,
      total:   parseInt(total?.count || '0'),
      limit,
      offset,
    })

  } catch (err: any) {
    if (err.message === 'UNAUTHORIZED')
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    console.error('[history GET]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth()
    const id   = req.nextUrl.searchParams.get('id')

    if (!id)
      return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 })

    const result = await query(
      'DELETE FROM checklist_history WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, user.id]
    )

    if (!result.length)
      return NextResponse.json({ error: 'Registro não encontrado' }, { status: 404 })

    return NextResponse.json({ ok: true })

  } catch (err: any) {
    if (err.message === 'UNAUTHORIZED')
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    console.error('[history DELETE]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
