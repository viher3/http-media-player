import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fs from 'node:fs'
import path from 'node:path'
import { parseFile, selectCover } from 'music-metadata'
import type { Db } from './db.js'
import { MEDIA_DIR, WEB_DIR } from './config.js'
import { normalizeRel, resolveInside } from './paths.js'
import { parseRange } from './range.js'
import { scan, scanStatus } from './scanner.js'

const MEDIA_COLS = `id, folder_id, filename, kind, mime, size, duration_ms, title, artist, album_artist,
  album, track_no, disc_no, year, genre, has_cover`

export function buildApp(db: Db, opts: { root?: string; webDir?: string } = {}) {
  const root = opts.root ?? MEDIA_DIR
  const app = Fastify({ logger: false })

  function folderPayload(id: number) {
    const folder = db.prepare('SELECT id, parent_id, path, name FROM folders WHERE id = ?').get(id) as
      | { id: number; parent_id: number | null; path: string; name: string } | undefined
    if (!folder) return null
    // breadcrumb: de la raíz a la carpeta actual
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
    db.prepare(`SELECT ${MEDIA_COLS}, path FROM media WHERE id = ?`).get(id) as any

  app.get<{ Params: { id: string } }>('/api/media/:id', async (req, reply) => {
    const m = getMedia(Number(req.params.id))
    if (!m) return reply.code(404).send({ error: 'no encontrado' })
    const { path: _p, ...pub } = m
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

  app.get<{ Params: { id: string } }>('/api/media/:id/cover', async (req, reply) => {
    const m = getMedia(Number(req.params.id))
    if (!m || !m.has_cover) return reply.code(404).send({ error: 'sin carátula' })
    const abs = resolveInside(root, m.path)
    if (!abs) return reply.code(404).send({ error: 'sin carátula' })
    try {
      const meta = await parseFile(abs, { skipPostHeaders: true })
      const pic = selectCover(meta.common.picture)
      if (!pic) return reply.code(404).send({ error: 'sin carátula' })
      return reply.header('Content-Type', pic.format).header('Cache-Control', 'public, max-age=86400')
        .send(Buffer.from(pic.data))
    } catch {
      return reply.code(404).send({ error: 'sin carátula' })
    }
  })

  app.post('/api/scan', async (_req, reply) => {
    if (!scanStatus.running) void scan(db, root).catch((e) => console.error('[scan]', e))
    return reply.code(202).send(scanStatus)
  })
  app.get('/api/scan/status', async () => scanStatus)

  // SPA estática
  const webDir = opts.webDir ?? WEB_DIR
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    app.register(fastifyStatic, { root: webDir })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'no encontrado' })
      return reply.sendFile('index.html')
    })
  }
  return app
}
