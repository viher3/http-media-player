import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { parseFile } from 'music-metadata'
import type { Db } from '../db.js'
import { DATA_DIR } from '../config.js'
import { normalizeRel, resolveInside } from '../paths.js'
import { parseRange } from '../range.js'
import { getCover, parseSize } from '../covers.js'
import { decodeText, listSubtitles, parseLrc, srtToVtt } from '../extras.js'
import { scan, scanStatus } from '../scanner.js'

export const MEDIA_COLS = `id, folder_id, filename, kind, mime, size, duration_ms, title, artist, album_artist,
  album, track_no, disc_no, year, genre, has_cover, artist_id, album_id`

/** Columnas públicas de media con prefijo de alias (para joins). */
export const mcols = (alias: string) =>
  MEDIA_COLS.split(',').map((c) => `${alias}.${c.trim()}`).join(', ')

export function registerLibrary(app: FastifyInstance, db: Db, root: string) {
  function folderPayload(id: number) {
    const folder = db.prepare('SELECT id, parent_id, path, name FROM folders WHERE id = ?').get(id) as
      | { id: number; parent_id: number | null; path: string; name: string } | undefined
    if (!folder) return null
    const breadcrumb: { id: number; name: string; path: string }[] = []
    let cur: typeof folder | undefined = folder
    while (cur) {
      breadcrumb.unshift({ id: cur.id, name: cur.name || 'Biblioteca', path: cur.path })
      cur = cur.parent_id
        ? (db.prepare('SELECT id, parent_id, path, name FROM folders WHERE id = ?').get(cur.parent_id) as any)
        : undefined
    }
    const folders = db.prepare(
      `SELECT f.id, f.name, f.path,
         (SELECT COUNT(*) FROM media m WHERE m.folder_id = f.id) AS media_count
       FROM folders f WHERE f.parent_id = ? ORDER BY f.name COLLATE NOCASE`).all(id)
    const media = db.prepare(
      `SELECT ${MEDIA_COLS} FROM media WHERE folder_id = ?
       ORDER BY COALESCE(disc_no, 0), COALESCE(track_no, 0), filename COLLATE NOCASE`).all(id)
    return { folder, breadcrumb, folders, media }
  }

  app.get('/api/folders', async () => {
    const r = db.prepare('SELECT id FROM folders WHERE parent_id IS NULL').get() as { id: number } | undefined
    return r ? folderPayload(r.id) : { folder: null, breadcrumb: [], folders: [], media: [] }
  })

  app.get<{ Querystring: { p?: string } }>('/api/folders/by-path', async (req, reply) => {
    const rel = normalizeRel(req.query.p ?? '')
    if (rel === null || !resolveInside(root, rel)) return reply.code(400).send({ error: 'ruta inválida' })
    const row = db.prepare('SELECT id FROM folders WHERE path = ?').get(rel) as { id: number } | undefined
    if (!row) return reply.code(404).send({ error: 'carpeta no encontrada' })
    return folderPayload(row.id)
  })

  app.get<{ Params: { id: string } }>('/api/folders/:id', async (req, reply) => {
    const p = folderPayload(Number(req.params.id))
    return p ?? reply.code(404).send({ error: 'carpeta no encontrada' })
  })

  const getMedia = (id: number) =>
    db.prepare(`SELECT ${MEDIA_COLS}, path, mime, mtime FROM media WHERE id = ?`).get(id) as any

  app.get<{ Params: { id: string } }>('/api/media/:id', async (req, reply) => {
    const m = getMedia(Number(req.params.id))
    if (!m) return reply.code(404).send({ error: 'no encontrado' })
    const { path: _p, mtime: _m, ...pub } = m
    return pub
  })

  app.get<{ Params: { id: string } }>('/api/media/:id/stream', async (req, reply) => {
    const m = getMedia(Number(req.params.id))
    if (!m) return reply.code(404).send({ error: 'no encontrado' })
    const abs = resolveInside(root, m.path)
    if (!abs) return reply.code(404).send({ error: 'no encontrado' })
    let size: number
    try { size = fs.statSync(abs).size } catch { return reply.code(404).send({ error: 'no encontrado' }) }

    reply.header('Accept-Ranges', 'bytes').header('Content-Type', m.mime)
    const range = parseRange(req.headers.range, size)
    if (range === 'unsatisfiable') {
      return reply.code(416).header('Content-Range', `bytes */${size}`).send()
    }
    if (range) {
      const { start, end } = range
      return reply.code(206)
        .header('Content-Range', `bytes ${start}-${end}/${size}`)
        .header('Content-Length', end - start + 1)
        .send(fs.createReadStream(abs, { start, end }))
    }
    return reply.header('Content-Length', size).send(fs.createReadStream(abs))
  })

  const sendCover = async (m: any, size: unknown, reply: any) => {
    const buf = m ? await getCover(root, DATA_DIR, m, parseSize(size)) : null
    if (!buf) return reply.code(404).send({ error: 'sin carátula' })
    return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=86400').send(buf)
  }

  app.get<{ Params: { id: string }; Querystring: { size?: string } }>('/api/media/:id/cover', (req, reply) =>
    sendCover(getMedia(Number(req.params.id)), req.query.size, reply))

  app.get<{ Params: { id: string }; Querystring: { size?: string } }>('/api/albums/:id/cover', (req, reply) => {
    const a = db.prepare('SELECT cover_media_id FROM albums WHERE id = ?').get(Number(req.params.id)) as any
    return sendCover(a?.cover_media_id ? getMedia(a.cover_media_id) : null, req.query.size, reply)
  })

  // --- subtítulos
  app.get<{ Params: { id: string } }>('/api/media/:id/subtitles', async (req, reply) => {
    const m = getMedia(Number(req.params.id))
    const abs = m && resolveInside(root, m.path)
    if (!abs) return reply.code(404).send({ error: 'no encontrado' })
    return listSubtitles(abs)
  })

  app.get<{ Params: { id: string; name: string } }>('/api/media/:id/subtitles/:name', async (req, reply) => {
    const m = getMedia(Number(req.params.id))
    const abs = m && resolveInside(root, m.path)
    if (!abs) return reply.code(404).send({ error: 'no encontrado' })
    // Solo se sirven nombres devueltos por listSubtitles (evita rutas arbitrarias)
    const sub = listSubtitles(abs).find((s) => s.name === req.params.name)
    if (!sub) return reply.code(404).send({ error: 'no encontrado' })
    const text = decodeText(fs.readFileSync(path.join(path.dirname(abs), sub.name)))
    return reply.header('Content-Type', 'text/vtt; charset=utf-8').send(srtToVtt(text))
  })

  // --- letras: .lrc junto al fichero, o etiqueta embebida
  app.get<{ Params: { id: string } }>('/api/media/:id/lyrics', async (req, reply) => {
    const m = getMedia(Number(req.params.id))
    const abs = m && resolveInside(root, m.path)
    if (!abs) return reply.code(404).send({ error: 'no encontrado' })
    const lrc = abs.slice(0, abs.length - path.extname(abs).length) + '.lrc'
    let text: string | null = null
    try {
      const real = resolveInside(root, path.relative(root, lrc))
      if (real) text = decodeText(fs.readFileSync(real))
    } catch { /* sin .lrc */ }
    if (text === null) {
      try {
        const meta = await parseFile(abs, { skipPostHeaders: true })
        const l = meta.common.lyrics?.[0]
        if (l?.syncText?.length) return { synced: l.syncText.filter((x) => x.timestamp !== undefined).map((x) => ({ t: (x.timestamp ?? 0) / 1000, text: x.text })), text: null }
        text = l?.text ?? null
      } catch { /* ignorar */ }
    }
    if (text === null) return { synced: null, text: null }
    const synced = parseLrc(text)
    return { synced, text: synced ? null : text }
  })

  app.post('/api/scan', async (req, reply) => {
    if (!req.user?.is_admin) return reply.code(403).send({ error: 'solo administradores' })
    if (!scanStatus.running) void scan(db, root).catch((e) => console.error('[scan]', e))
    return reply.code(202).send(scanStatus)
  })
  app.get('/api/scan/status', async () => scanStatus)
}
