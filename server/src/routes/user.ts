import type { FastifyInstance } from 'fastify'
import type { Db } from '../db.js'
import { mcols } from './library.js'

export function registerUserState(app: FastifyInstance, db: Db) {
  const pathOf = (id: unknown) =>
    (db.prepare('SELECT path FROM media WHERE id = ?').get(Number(id)) as { path: string } | undefined)?.path

  // --- favoritos
  app.get('/api/favorites', async (req) =>
    db.prepare(
      `SELECT ${mcols('m')} FROM favorites f JOIN media m ON m.path = f.path
       WHERE f.user_id = ? ORDER BY f.created_at DESC`).all(req.user!.id))

  app.get('/api/favorites/ids', async (req) =>
    (db.prepare('SELECT m.id FROM favorites f JOIN media m ON m.path = f.path WHERE f.user_id = ?')
      .all(req.user!.id) as { id: number }[]).map((r) => r.id))

  app.put<{ Params: { id: string } }>('/api/favorites/:id', async (req, reply) => {
    const p = pathOf(req.params.id)
    if (!p) return reply.code(404).send({ error: 'no encontrado' })
    db.prepare('INSERT OR IGNORE INTO favorites(user_id, path, created_at) VALUES (?, ?, ?)').run(req.user!.id, p, Date.now())
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/api/favorites/:id', async (req, reply) => {
    const p = pathOf(req.params.id)
    if (!p) return reply.code(404).send({ error: 'no encontrado' })
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND path = ?').run(req.user!.id, p)
    return { ok: true }
  })

  // --- historial
  app.post<{ Body: { media_id?: number } }>('/api/history', async (req, reply) => {
    const p = pathOf(req.body?.media_id)
    if (!p) return reply.code(404).send({ error: 'no encontrado' })
    db.prepare('INSERT INTO play_history(user_id, path, played_at) VALUES (?, ?, ?)').run(req.user!.id, p, Date.now())
    return { ok: true }
  })

  // --- posición de reanudación
  app.get<{ Params: { id: string } }>('/api/resume/:id', async (req, reply) => {
    const p = pathOf(req.params.id)
    if (!p) return reply.code(404).send({ error: 'no encontrado' })
    const r = db.prepare('SELECT position_ms FROM resume WHERE user_id = ? AND path = ?').get(req.user!.id, p) as
      { position_ms: number } | undefined
    return { position_ms: r?.position_ms ?? 0 }
  })

  app.put<{ Params: { id: string }; Body: { position_ms?: number; duration_ms?: number } }>(
    '/api/resume/:id', async (req, reply) => {
      const p = pathOf(req.params.id)
      if (!p) return reply.code(404).send({ error: 'no encontrado' })
      const pos = Math.round(Number(req.body?.position_ms))
      const dur = Math.round(Number(req.body?.duration_ms ?? 0))
      if (!Number.isFinite(pos) || pos < 0) return reply.code(400).send({ error: 'posición inválida' })
      // Casi al principio o casi al final: no hay nada que reanudar
      if (pos < 5000 || (dur > 0 && pos > dur - 5000)) {
        db.prepare('DELETE FROM resume WHERE user_id = ? AND path = ?').run(req.user!.id, p)
      } else {
        db.prepare(
          `INSERT INTO resume(user_id, path, position_ms, duration_ms, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, path) DO UPDATE SET position_ms = excluded.position_ms,
             duration_ms = excluded.duration_ms, updated_at = excluded.updated_at`)
          .run(req.user!.id, p, pos, dur || null, Date.now())
      }
      return { ok: true }
    })
}
