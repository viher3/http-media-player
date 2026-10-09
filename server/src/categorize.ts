import type { Db } from './db.js'
import fs from 'node:fs'
import path from 'node:path'

/** Clave de comparación: sin tildes, minúsculas, sin "the ", sin puntuación. */
export function normKey(s: string): string {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export const COVER_NAMES = ['cover', 'folder', 'front', 'albumart', 'album']
export const COVER_EXTS = ['jpg', 'jpeg', 'png', 'webp']

/** Busca cover.jpg / folder.jpg… en un directorio (sin distinguir mayúsculas). */
export function findFolderCover(absDir: string): string | null {
  let names: string[]
  try { names = fs.readdirSync(absDir) } catch { return null }
  for (const base of COVER_NAMES) {
    for (const ext of COVER_EXTS) {
      const hit = names.find((n) => n.toLowerCase() === `${base}.${ext}`)
      if (hit) return path.join(absDir, hit)
    }
  }
  return null
}

type Row = {
  id: number; path: string; title: string | null; artist: string | null; album_artist: string | null
  album: string | null; year: number | null; track_no: number | null; has_cover: number; folder_id: number
}

/** Artista/álbum "efectivos" de una pista, con inferencia desde Artista/Álbum/NN - Título.ext. */
export function inferCategory(r: Pick<Row, 'path' | 'artist' | 'album_artist' | 'album'>) {
  const dirs = r.path.split('/').slice(0, -1)
  let artist = r.album_artist?.trim() || r.artist?.trim() || null
  let album = r.album?.trim() || null
  if (!album && !artist) {
    if (dirs.length >= 2) { artist = dirs[dirs.length - 2]; album = dirs[dirs.length - 1] }
    else if (dirs.length === 1) album = dirs[0]
  } else if (album && !artist && dirs.length >= 2) {
    artist = dirs[dirs.length - 2]
  }
  return { artist, album }
}

function mostCommon(counts: Map<string, number>): string {
  let best = '', n = -1
  for (const [k, v] of counts) if (v > n || (v === n && k < best)) { best = k; n = v }
  return best
}

/**
 * Reconstruye artistas/álbumes, cobertura de carpeta e índice FTS a partir de la tabla media.
 * Es idempotente; los ids de artistas/álbumes se conservan entre ejecuciones (upsert por clave).
 */
export function categorize(db: Db, root: string) {
  const rows = db.prepare(
    `SELECT id, path, title, artist, album_artist, album, year, track_no, has_cover, folder_id
     FROM media WHERE kind = 'audio' ORDER BY COALESCE(disc_no,0), COALESCE(track_no,0), filename`).all() as Row[]

  const artistNames = new Map<string, Map<string, number>>()
  const albumInfo = new Map<string, { artistKey: string | null; titles: Map<string, number>; year: number | null; cover: number | null }>()
  const assign: { id: number; artistKey: string | null; albumKey: string | null }[] = []

  for (const r of rows) {
    const { artist, album } = inferCategory(r)
    const aKey = artist ? normKey(artist) || null : null
    if (artist && aKey) {
      const m = artistNames.get(aKey) ?? new Map()
      m.set(artist, (m.get(artist) ?? 0) + 1)
      artistNames.set(aKey, m)
    }
    let albKey: string | null = null
    if (album && normKey(album)) {
      albKey = `${aKey ?? ''}|${normKey(album)}`
      const info = albumInfo.get(albKey) ?? { artistKey: aKey, titles: new Map(), year: null, cover: null }
      info.titles.set(album, (info.titles.get(album) ?? 0) + 1)
      if (r.year && (info.year === null || r.year < info.year)) info.year = r.year
      if (info.cover === null && r.has_cover) info.cover = r.id
      albumInfo.set(albKey, info)
    }
    assign.push({ id: r.id, artistKey: aKey, albumKey: albKey })
  }

  db.transaction(() => {
    const upArtist = db.prepare(
      `INSERT INTO artists(key, name) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name RETURNING id`)
    const artistId = new Map<string, number>()
    for (const [key, names] of artistNames) artistId.set(key, (upArtist.get(key, mostCommon(names)) as { id: number }).id)

    const upAlbum = db.prepare(
      `INSERT INTO albums(key, artist_id, title, year, cover_media_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET artist_id = excluded.artist_id, title = excluded.title,
         year = excluded.year, cover_media_id = excluded.cover_media_id RETURNING id`)
    const albumId = new Map<string, number>()
    for (const [key, info] of albumInfo) {
      albumId.set(key, (upAlbum.get(key, info.artistKey ? artistId.get(info.artistKey) : null,
        mostCommon(info.titles), info.year, info.cover) as { id: number }).id)
    }

    db.exec('UPDATE media SET artist_id = NULL, album_id = NULL')
    const setCat = db.prepare('UPDATE media SET artist_id = ?, album_id = ? WHERE id = ?')
    for (const a of assign) {
      setCat.run(a.artistKey ? artistId.get(a.artistKey) : null, a.albumKey ? albumId.get(a.albumKey) : null, a.id)
    }
    // Entidades huérfanas
    db.exec(`DELETE FROM albums WHERE id NOT IN (SELECT album_id FROM media WHERE album_id IS NOT NULL)`)
    db.exec(`DELETE FROM artists WHERE id NOT IN (SELECT artist_id FROM media WHERE artist_id IS NOT NULL)`)

    // Carátula de carpeta (has_cover: 1 = embebida, 2 = fichero de la carpeta)
    const folders = db.prepare('SELECT id, path FROM folders').all() as { id: number; path: string }[]
    const withCover = db.prepare(`UPDATE media SET has_cover = 2 WHERE folder_id = ? AND has_cover IN (0, 2)`)
    const without = db.prepare(`UPDATE media SET has_cover = 0 WHERE folder_id = ? AND has_cover = 2`)
    for (const f of folders) (findFolderCover(path.join(root, f.path)) ? withCover : without).run(f.id)

    db.exec(`UPDATE albums SET cover_media_id = (
      SELECT m.id FROM media m WHERE m.album_id = albums.id AND m.has_cover > 0
      ORDER BY COALESCE(m.disc_no, 0), COALESCE(m.track_no, 0), m.id LIMIT 1)`)

    // Búsqueda de texto completo
    db.exec('DELETE FROM media_fts')
    db.exec(`INSERT INTO media_fts(rowid, title, artist, album, filename)
             SELECT id, COALESCE(title,''), COALESCE(artist,''), COALESCE(album,''), filename FROM media`)
  })()
}
