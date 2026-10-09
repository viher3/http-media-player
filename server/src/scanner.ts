import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { parseFile } from 'music-metadata'
import type { Db } from './db.js'
import { AUDIO_EXT, MEDIA_DIR, MIME, VIDEO_EXT } from './config.js'
import { categorize } from './categorize.js'

export type ScanStatus = {
  running: boolean
  processed: number
  total: number
  errors: number
  startedAt: number | null
  finishedAt: number | null
}

export const scanStatus: ScanStatus = {
  running: false, processed: 0, total: 0, errors: 0, startedAt: null, finishedAt: null,
}

/** Eventos: 'progress' (throttled) y 'done'. Los consume el canal SSE. */
export const scanEvents = new EventEmitter()
let lastEmit = 0
const emitProgress = (force = false) => {
  const now = Date.now()
  if (force || now - lastEmit > 300) { lastEmit = now; scanEvents.emit('progress', { ...scanStatus }) }
}

type Found = { rel: string; abs: string; size: number; mtime: number; ext: string }

function walk(root: string, dirs: Set<string>, files: Found[]) {
  const visit = (absDir: string, rel: string) => {
    dirs.add(rel)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true })
    } catch (e) {
      console.warn(`[scan] no se puede leer ${absDir}:`, (e as Error).message)
      scanStatus.errors++
      return
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue
      let abs = path.join(absDir, ent.name)
      const relChild = rel ? `${rel}/${ent.name}` : ent.name
      try {
        if (ent.isSymbolicLink()) {
          // Solo se siguen symlinks que resuelven dentro de MEDIA_DIR
          const real = fs.realpathSync(abs)
          if (real !== root && !real.startsWith(root + path.sep)) continue
          abs = real
        }
        const st = fs.statSync(abs)
        if (st.isDirectory()) {
          if (ent.isSymbolicLink()) continue // evita ciclos
          visit(abs, relChild)
        } else if (st.isFile()) {
          const ext = path.extname(ent.name).slice(1).toLowerCase()
          if (AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext)) {
            files.push({ rel: relChild, abs, size: st.size, mtime: Math.floor(st.mtimeMs), ext })
          }
        }
      } catch (e) {
        console.warn(`[scan] omitido ${abs}:`, (e as Error).message)
        scanStatus.errors++
      }
    }
  }
  visit(root, '')
}

const num = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? n : null)

async function readTags(f: Found) {
  const base = path.basename(f.rel, path.extname(f.rel))
  // "01 - Título", "01. Título", "1-03 Título" cuando no hay etiqueta de título
  const numbered = /^(\d{1,3})\s*[-._)]\s*(.+)$/.exec(base)
  const out = {
    duration_ms: null as number | null, title: numbered ? numbered[2].trim() : base, artist: null as string | null,
    album_artist: null as string | null, album: null as string | null,
    track_no: (numbered ? Number(numbered[1]) : null) as number | null, disc_no: null as number | null,
    year: null as number | null, genre: null as string | null, has_cover: 0,
  }
  try {
    const m = await parseFile(f.abs, { duration: true, skipCovers: false })
    const c = m.common
    out.duration_ms = m.format.duration ? Math.round(m.format.duration * 1000) : null
    out.title = c.title?.trim() || out.title
    out.artist = c.artist?.trim() || null
    out.album_artist = c.albumartist?.trim() || null
    out.album = c.album?.trim() || null
    out.track_no = num(c.track.no) ?? out.track_no
    out.disc_no = num(c.disk.no)
    out.year = num(c.year)
    out.genre = c.genre?.[0] ?? null
    out.has_cover = c.picture?.length ? 1 : 0
  } catch (e) {
    console.warn(`[scan] metadatos ilegibles en ${f.rel}:`, (e as Error).message)
    scanStatus.errors++
  }
  return out
}

let current: Promise<void> | null = null

/** Escaneo incremental. Si ya hay uno en curso, devuelve esa misma promesa. */
export function scan(db: Db, root = MEDIA_DIR): Promise<void> {
  if (current) return current
  current = run(db, root).finally(() => { current = null })
  return current
}

async function run(db: Db, root: string) {
  Object.assign(scanStatus, {
    running: true, processed: 0, total: 0, errors: 0, startedAt: Date.now(), finishedAt: null,
  })
  emitProgress(true)
  try {
    const dirs = new Set<string>()
    const files: Found[] = []
    walk(root, dirs, files)
    scanStatus.total = files.length

    // --- carpetas (padres antes que hijos)
    const folderId = new Map<string, number>()
    const sortedDirs = [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    const upsertFolder = db.prepare(
      `INSERT INTO folders(parent_id, path, name) VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET name = excluded.name RETURNING id`)
    db.transaction(() => {
      for (const d of sortedDirs) {
        const parent = d === '' ? null : folderId.get(d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '')!
        const name = d === '' ? '' : d.slice(d.lastIndexOf('/') + 1)
        const row = upsertFolder.get(parent, d, name) as { id: number }
        folderId.set(d, row.id)
      }
      const del = db.prepare('DELETE FROM folders WHERE id = ?')
      for (const r of db.prepare('SELECT id, path FROM folders').all() as { id: number; path: string }[]) {
        if (!dirs.has(r.path)) del.run(r.id)
      }
    })()

    // --- ficheros
    const existing = new Map<string, { id: number; size: number; mtime: number; folder_id: number }>()
    for (const r of db.prepare('SELECT id, path, size, mtime, folder_id FROM media').all() as any[]) existing.set(r.path, r)

    const insert = db.prepare(`INSERT INTO media
      (folder_id, path, filename, kind, mime, size, mtime, duration_ms, title, artist, album_artist, album,
       track_no, disc_no, year, genre, has_cover, scanned_at)
      VALUES (@folder_id, @path, @filename, @kind, @mime, @size, @mtime, @duration_ms, @title, @artist,
       @album_artist, @album, @track_no, @disc_no, @year, @genre, @has_cover, @scanned_at)
      ON CONFLICT(path) DO UPDATE SET folder_id=excluded.folder_id, filename=excluded.filename,
       kind=excluded.kind, mime=excluded.mime, size=excluded.size, mtime=excluded.mtime,
       duration_ms=excluded.duration_ms, title=excluded.title, artist=excluded.artist,
       album_artist=excluded.album_artist, album=excluded.album, track_no=excluded.track_no,
       disc_no=excluded.disc_no, year=excluded.year, genre=excluded.genre,
       has_cover=excluded.has_cover, scanned_at=excluded.scanned_at`)

    const seen = new Set<string>()
    for (const f of files) {
      seen.add(f.rel)
      const prev = existing.get(f.rel)
      const dir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : ''
      if (!prev || prev.size !== f.size || prev.mtime !== f.mtime) {
        const tags = await readTags(f)
        insert.run({
          folder_id: folderId.get(dir)!, path: f.rel, filename: path.basename(f.rel),
          kind: AUDIO_EXT.has(f.ext) ? 'audio' : 'video', mime: MIME[f.ext],
          size: f.size, mtime: f.mtime, scanned_at: Date.now(), ...tags,
        })
      }
      scanStatus.processed++
      emitProgress()
    }
    const delMedia = db.prepare('DELETE FROM media WHERE id = ?')
    db.transaction(() => {
      for (const [p, r] of existing) if (!seen.has(p)) delMedia.run(r.id)
    })()

    categorize(db, root)
  } finally {
    scanStatus.running = false
    scanStatus.finishedAt = Date.now()
    emitProgress(true)
    scanEvents.emit('done', { ...scanStatus })
  }
}
