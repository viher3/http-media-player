import type { FastifyInstance } from 'fastify'
import type { Db } from '../db.js'
import { MEDIA_COLS, mcols } from './library.js'

const TRACK_ORDER = `ORDER BY COALESCE(disc_no,0), COALESCE(track_no,0), filename COLLATE NOCASE`

/** Convierte texto libre en consulta FTS5 segura con prefijos: `foo bar` -> `"foo"* "bar"*`. */
export function ftsQuery(q: string): string | null {
  const terms = q.normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8)
  return terms.length ? terms.map((t) => `"${t}"*`).join(' ') : null
}

export function registerBrowse(app: FastifyInstance, db: Db) {
  app.get('/api/artists', async () =>
    db.prepare(
      `SELECT a.id, a.name,
         (SELECT COUNT(*) FROM albums al WHERE al.artist_id = a.id) AS album_count,
         (SELECT COUNT(*) FROM media m WHERE m.artist_id = a.id) AS track_count,
         (SELECT al.id FROM albums al WHERE al.artist_id = a.id AND al.cover_media_id IS NOT NULL LIMIT 1) AS cover_album_id
       FROM artists a ORDER BY a.name COLLATE NOCASE`).all())

  app.get<{ Params: { id: string } }>('/api/artists/:id', async (req, reply) => {
    const id = Number(req.params.id)
    const artist = db.prepare('SELECT id, name FROM artists WHERE id = ?').get(id)
    if (!artist) return reply.code(404).send({ error: 'no encontrado' })
    const albums = db.prepare(
      `SELECT al.id, al.title, al.year, al.artist_id, ? AS artist_name, al.cover_media_id IS NOT NULL AS has_cover,
         (SELECT COUNT(*) FROM media m WHERE m.album_id = al.id) AS track_count
       FROM albums al WHERE al.artist_id = ? ORDER BY COALESCE(al.year, 9999), al.title COLLATE NOCASE`)
      .all((artist as any).name, id)
    const singles = db.prepare(
      `SELECT ${MEDIA_COLS} FROM media WHERE artist_id = ? AND album_id IS NULL ${TRACK_ORDER}`).all(id)
    return { artist, albums, singles }
  })

  app.get<{ Querystring: { sort?: string } }>('/api/albums', async (req) => {
    const order = req.query.sort === 'year' ? 'COALESCE(al.year, 0) DESC, al.title COLLATE NOCASE'
      : req.query.sort === 'recent' ? '(SELECT MAX(scanned_at) FROM media m WHERE m.album_id = al.id) DESC'
      : 'al.title COLLATE NOCASE'
    return db.prepare(
      `SELECT al.id, al.title, al.year, al.artist_id, ar.name AS artist_name, al.cover_media_id IS NOT NULL AS has_cover,
         (SELECT COUNT(*) FROM media m WHERE m.album_id = al.id) AS track_count
       FROM albums al LEFT JOIN artists ar ON ar.id = al.artist_id ORDER BY ${order}`).all()
  })

  app.get<{ Params: { id: string } }>('/api/albums/:id', async (req, reply) => {
    const id = Number(req.params.id)
    const album = db.prepare(
      `SELECT al.id, al.title, al.year, al.artist_id, ar.name AS artist_name, al.cover_media_id IS NOT NULL AS has_cover
       FROM albums al LEFT JOIN artists ar ON ar.id = al.artist_id WHERE al.id = ?`).get(id)
    if (!album) return reply.code(404).send({ error: 'no encontrado' })
    const tracks = db.prepare(`SELECT ${MEDIA_COLS} FROM media WHERE album_id = ? ${TRACK_ORDER}`).all(id)
    return { album, tracks }
  })

  app.get('/api/genres', async () =>
    db.prepare(
      `SELECT genre AS name, COUNT(*) AS track_count FROM media
       WHERE genre IS NOT NULL AND genre != '' GROUP BY genre ORDER BY genre COLLATE NOCASE`).all())

  app.get<{ Params: { name: string } }>('/api/genres/:name', async (req) => ({
    name: req.params.name,
    tracks: db.prepare(
      `SELECT ${MEDIA_COLS} FROM media WHERE genre = ? ORDER BY COALESCE(artist,'') COLLATE NOCASE,
       COALESCE(album,'') COLLATE NOCASE, COALESCE(disc_no,0), COALESCE(track_no,0)`).all(req.params.name),
  }))

  app.get('/api/videos', async () =>
    db.prepare(
      `SELECT ${mcols('m')}, f.path AS folder_path
       FROM media m JOIN folders f ON f.id = m.folder_id WHERE m.kind = 'video'
       ORDER BY f.path COLLATE NOCASE, m.filename COLLATE NOCASE`).all())

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => {
    const q = (req.query.q ?? '').slice(0, 100)
    const fts = ftsQuery(q)
    if (!fts) return { media: [], albums: [], artists: [] }
    const like = `%${q.trim().replace(/[\\%_]/g, '\\$&')}%`
    const media = db.prepare(
      `SELECT ${mcols('m')}
       FROM media_fts JOIN media m ON m.id = media_fts.rowid
       WHERE media_fts MATCH ? ORDER BY bm25(media_fts, 5, 3, 2, 1) LIMIT 100`).all(fts)
    const albums = db.prepare(
      `SELECT al.id, al.title, al.year, al.artist_id, ar.name AS artist_name, al.cover_media_id IS NOT NULL AS has_cover,
         (SELECT COUNT(*) FROM media m WHERE m.album_id = al.id) AS track_count
       FROM albums al LEFT JOIN artists ar ON ar.id = al.artist_id
       WHERE al.title LIKE ? ESCAPE '\\' ORDER BY al.title COLLATE NOCASE LIMIT 30`).all(like)
    const artists = db.prepare(
      `SELECT id, name FROM artists WHERE name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 30`).all(like)
    return { media, albums, artists }
  })

  // Listas automáticas
  app.get('/api/lists/recently-added', async () =>
    db.prepare(`SELECT ${MEDIA_COLS} FROM media ORDER BY mtime DESC, id DESC LIMIT 50`).all())

  app.get('/api/lists/recently-played', async (req) =>
    db.prepare(
      `SELECT ${mcols('m')}
       FROM (SELECT path, MAX(played_at) AS last FROM play_history WHERE user_id = ? GROUP BY path) h
       JOIN media m ON m.path = h.path ORDER BY h.last DESC LIMIT 50`).all(req.user!.id))

  app.get('/api/lists/most-played', async (req) =>
    db.prepare(
      `SELECT ${mcols('m')}, h.plays
       FROM (SELECT path, COUNT(*) AS plays FROM play_history WHERE user_id = ? GROUP BY path) h
       JOIN media m ON m.path = h.path ORDER BY h.plays DESC, m.title LIMIT 50`).all(req.user!.id))
}
