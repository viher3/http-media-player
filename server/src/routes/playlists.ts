import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from '../db.js'
import { MEDIA_COLS } from './library.js'

const MAX_ITEMS = 10_000

type Item = { id: number; position: number; path: string; title_cache: string | null; artist_cache: string | null; duration_cache: number | null }

export function registerPlaylists(app: FastifyInstance, db: Db) {
  const owned = (req: FastifyRequest, reply: FastifyReply, id: unknown) => {
    const pl = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(Number(id), req.user!.id) as
      { id: number; name: string; created_at: number; updated_at: number } | undefined
    if (!pl) reply.code(404).send({ error: 'playlist no encontrada' })
    return pl
  }
  const touch = (id: number) => db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), id)
  const cleanName = (n: unknown) => (typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= 100 ? n.trim() : null)

  const mediaByPath = db.prepare(`SELECT ${MEDIA_COLS}, path FROM media WHERE path = ?`)
  const mediaById = db.prepare(`SELECT ${MEDIA_COLS}, path FROM media WHERE id = ?`)
  const count = db.prepare('SELECT COUNT(*) n FROM playlist_items WHERE playlist_id = ?')
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) p FROM playlist_items WHERE playlist_id = ?')
  const insertItem = db.prepare(
    `INSERT INTO playlist_items(playlist_id, position, path, title_cache, artist_cache, duration_cache) VALUES (?, ?, ?, ?, ?, ?)`)

  function addMedia(playlistId: number, ids: unknown[]) {
    let pos = (maxPos.get(playlistId) as { p: number }).p + 1
    let room = MAX_ITEMS - (count.get(playlistId) as { n: number }).n
    let added = 0
    for (const id of ids) {
      if (room <= 0) break
      const m = mediaById.get(Number(id)) as any
      if (!m) continue
      insertItem.run(playlistId, pos++, m.path, m.title, m.artist, m.duration_ms)
      room--; added++
    }
    return added
  }

  app.get('/api/playlists', async (req) =>
    db.prepare(
      `SELECT p.id, p.name, p.updated_at, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS track_count,
         (SELECT m.id FROM playlist_items i JOIN media m ON m.path = i.path
          WHERE i.playlist_id = p.id AND m.has_cover > 0 ORDER BY i.position LIMIT 1) AS cover_media_id
       FROM playlists p WHERE p.user_id = ? ORDER BY p.updated_at DESC`).all(req.user!.id))

  app.post<{ Body: { name?: unknown; media_ids?: unknown[] } }>('/api/playlists', async (req, reply) => {
    const name = cleanName(req.body?.name)
    if (!name) return reply.code(400).send({ error: 'nombre inválido' })
    const now = Date.now()
    const id = db.transaction(() => {
      const pid = db.prepare('INSERT INTO playlists(user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(req.user!.id, name, now, now).lastInsertRowid as number
      if (Array.isArray(req.body?.media_ids)) addMedia(pid, req.body.media_ids)
      return pid
    })()
    return reply.code(201).send({ id, name })
  })

  app.get<{ Params: { id: string } }>('/api/playlists/:id', async (req, reply) => {
    const pl = owned(req, reply, req.params.id)
    if (!pl) return
    const rows = db.prepare('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position').all(pl.id) as Item[]
    const items = rows.map((r) => {
      const m = mediaByPath.get(r.path) as any
      if (m) delete m.path
      return {
        item_id: r.id, position: r.position, available: !!m, media: m ?? null,
        title: m?.title || m?.filename || r.title_cache || r.path.split('/').pop(), artist: m?.artist ?? r.artist_cache,
      }
    })
    return { playlist: { id: pl.id, name: pl.name, updated_at: pl.updated_at }, items }
  })

  app.patch<{ Params: { id: string }; Body: { name?: unknown } }>('/api/playlists/:id', async (req, reply) => {
    const pl = owned(req, reply, req.params.id)
    if (!pl) return
    const name = cleanName(req.body?.name)
    if (!name) return reply.code(400).send({ error: 'nombre inválido' })
    db.prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), pl.id)
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/api/playlists/:id', async (req, reply) => {
    const pl = owned(req, reply, req.params.id)
    if (!pl) return
    db.prepare('DELETE FROM playlists WHERE id = ?').run(pl.id)
    return { ok: true }
  })

  app.post<{ Params: { id: string }; Body: { media_ids?: unknown[] } }>('/api/playlists/:id/items', async (req, reply) => {
    const pl = owned(req, reply, req.params.id)
    if (!pl) return
    if (!Array.isArray(req.body?.media_ids)) return reply.code(400).send({ error: 'media_ids requerido' })
    const added = db.transaction(() => addMedia(pl.id, req.body.media_ids!))()
    touch(pl.id)
    return { added }
  })

  app.delete<{ Params: { id: string; itemId: string } }>('/api/playlists/:id/items/:itemId', async (req, reply) => {
    const pl = owned(req, reply, req.params.id)
    if (!pl) return
    const r = db.prepare('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?').run(Number(req.params.itemId), pl.id)
    if (!r.changes) return reply.code(404).send({ error: 'elemento no encontrado' })
    // Compacta posiciones
    const ids = db.prepare('SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position').all(pl.id) as { id: number }[]
    const up = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ?')
    db.transaction(() => ids.forEach((x, i) => up.run(i, x.id)))()
    touch(pl.id)
    return { ok: true }
  })

  app.put<{ Params: { id: string }; Body: { item_ids?: unknown[] } }>('/api/playlists/:id/order', async (req, reply) => {
    const pl = owned(req, reply, req.params.id)
    if (!pl) return
    const current = (db.prepare('SELECT id FROM playlist_items WHERE playlist_id = ?').all(pl.id) as { id: number }[]).map((r) => r.id)
    const next = req.body?.item_ids
    if (!Array.isArray(next) || next.length !== current.length || new Set(next).size !== next.length ||
        !next.every((n) => current.includes(Number(n)))) {
      return reply.code(400).send({ error: 'item_ids debe ser una permutación de los elementos actuales' })
    }
    const up = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ?')
    db.transaction(() => next.forEach((id, i) => up.run(i, Number(id))))()
    touch(pl.id)
    return { ok: true }
  })

  // --- .m3u8
  app.get<{ Params: { id: string } }>('/api/playlists/:id/export.m3u8', async (req, reply) => {
    const pl = owned(req, reply, req.params.id)
    if (!pl) return
    const rows = db.prepare('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position').all(pl.id) as Item[]
    const lines = ['#EXTM3U', `#PLAYLIST:${pl.name.replace(/[\r\n]/g, ' ')}`]
    for (const r of rows) {
      const m = mediaByPath.get(r.path) as any
      const title = (m?.title ?? r.title_cache ?? r.path).replace(/[\r\n]/g, ' ')
      const artist = m?.artist ?? r.artist_cache
      const dur = Math.round(((m?.duration_ms ?? r.duration_cache) ?? 0) / 1000) || -1
      lines.push(`#EXTINF:${dur},${artist ? `${artist} - ` : ''}${title}`.replace(/[\r\n]/g, ' '), r.path)
    }
    const fname = encodeURIComponent(pl.name.replace(/[^\p{L}\p{N} ._-]/gu, '_')) + '.m3u8'
    return reply.header('Content-Type', 'audio/x-mpegurl; charset=utf-8')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${fname}`)
      .send(lines.join('\n') + '\n')
  })

  const byPath = db.prepare(`SELECT id FROM media WHERE path = ? OR path LIKE ? ESCAPE '\\' LIMIT 2`)
  const escLike = (s: string) => s.replace(/[\\%_]/g, '\\$&')

  /** Empareja una entrada de m3u con un medio: ruta completa y, si no, sufijos cada vez más cortos mientras sean únicos. */
  function matchEntry(entry: string): number | null {
    const parts = entry.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..')
    const exact = parts.length ? (db.prepare('SELECT id FROM media WHERE path = ?').get(parts.join('/')) as { id: number } | undefined) : undefined
    if (exact) return exact.id
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/')
      const hits = byPath.all(suffix, '%/' + escLike(suffix)) as { id: number }[]
      if (hits.length === 1) return hits[0].id
      if (hits.length > 1) return null // ambiguo
    }
    return null
  }

  app.post<{ Body: { name?: unknown; m3u?: unknown } }>('/api/playlists/import', async (req, reply) => {
    const name = cleanName(req.body?.name)
    if (!name || typeof req.body?.m3u !== 'string') return reply.code(400).send({ error: 'name y m3u requeridos' })
    const lines = req.body.m3u.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim())
    const found: number[] = []
    let missing = 0
    let pendingTitle: string | null = null
    const unmatched: { path: string; title: string | null }[] = []
    for (const l of lines) {
      if (!l) continue
      if (l.startsWith('#EXTINF:')) { pendingTitle = l.slice(l.indexOf(',') + 1).trim() || null; continue }
      if (l.startsWith('#')) continue
      const id = matchEntry(l)
      if (id) found.push(id)
      else { missing++; unmatched.push({ path: l.slice(0, 500), title: pendingTitle }) }
      pendingTitle = null
      if (found.length + missing >= MAX_ITEMS) break
    }
    const now = Date.now()
    const id = db.transaction(() => {
      const pid = db.prepare('INSERT INTO playlists(user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(req.user!.id, name, now, now).lastInsertRowid as number
      addMedia(pid, found)
      // Las entradas sin coincidencia se conservan como "no disponibles"
      let pos = (maxPos.get(pid) as { p: number }).p + 1
      for (const u of unmatched) insertItem.run(pid, pos++, u.path, u.title, null, null)
      return pid
    })()
    return reply.code(201).send({ id, name, matched: found.length, missing })
  })
}
