// src/app/api/checklist/route.ts
// GET  /api/checklist          → busca ou cria checklist de hoje
// PUT  /api/checklist          → salva alterações e grava histórico

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { query, queryOne, withTransaction } from '@/lib/db'

// ── GET: busca o checklist do dia ──────────────────────────────

export async function GET() {
  try {
    const user = await requireAuth()

    // Usa a função do banco que cria o checklist se não existir
    const checklist = await queryOne(
      'SELECT * FROM get_or_create_today_checklist($1)',
      [user.id]
    )

    const tasks = await query(
      'SELECT * FROM tasks WHERE checklist_id = $1 ORDER BY position',
      [checklist.id]
    )

    const tracking = await query(
      'SELECT * FROM tracking_items WHERE checklist_id = $1 ORDER BY created_at',
      [checklist.id]
    )

    return NextResponse.json({ checklist, tasks, tracking })

  } catch (err: any) {
    if (err.message === 'UNAUTHORIZED')
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    console.error('[checklist GET]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// ── PUT: salva alterações ──────────────────────────────────────

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const { checklistId, priority, goalMet, difficult, improve, tasks, tracking } = body

    await withTransaction(async (client) => {

      // 1. Atualiza campos principais do checklist
      await client.query(
        `UPDATE checklists
         SET priority = $1, goal_met = $2, difficult = $3, improve = $4
         WHERE id = $5 AND user_id = $6`,
        [priority ?? null, goalMet ?? null, difficult ?? null, improve ?? null, checklistId, user.id]
      )

      // 2. Atualiza cada tarefa
      if (tasks?.length) {
        for (const task of tasks) {
          await client.query(
            `UPDATE tasks
             SET text = $1, done = $2,
                 done_at = CASE WHEN $2 = TRUE AND done = FALSE THEN NOW()
                                WHEN $2 = FALSE THEN NULL
                                ELSE done_at END
             WHERE checklist_id = $3 AND position = $4`,
            [task.text ?? '', !!task.done, checklistId, task.position]
          )
        }
      }

      // 3. Atualiza cada item de acompanhamento
      if (tracking?.length) {
        for (const item of tracking) {
          await client.query(
            `UPDATE tracking_items
             SET done = $1,
                 done_at = CASE WHEN $1 = TRUE AND done = FALSE THEN NOW()
                                WHEN $1 = FALSE THEN NULL
                                ELSE done_at END
             WHERE checklist_id = $2 AND label = $3`,
            [!!item.done, checklistId, item.label]
          )
        }
      }

      // 4. Grava snapshot no histórico manualmente
      // (o trigger do banco também faz isso, aqui é para garantir consistência)
      const snap = {
        savedAt:   new Date().toISOString(),
        priority,
        goalMet,
        difficult,
        improve,
        tasks,
        tracking,
      }
      await client.query(
        `INSERT INTO checklist_history (checklist_id, user_id, snapshot, change_type)
         VALUES ($1, $2, $3, 'auto')`,
        [checklistId, user.id, JSON.stringify(snap)]
      )
    })

    return NextResponse.json({ ok: true, savedAt: new Date().toISOString() })

  } catch (err: any) {
    if (err.message === 'UNAUTHORIZED')
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    console.error('[checklist PUT]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
