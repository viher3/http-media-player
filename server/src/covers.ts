import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { parseFile, selectCover } from 'music-metadata'
import { findFolderCover } from './categorize.js'
import { resolveInside } from './paths.js'

export const COVER_SIZES = [64, 128, 256, 512, 1024]

export type CoverMedia = { path: string; mtime: number; has_cover: number }

/** Devuelve una miniatura JPEG (cacheada en disco) de la carátula de un medio, o null. */
export async function getCover(root: string, dataDir: string, m: CoverMedia, size: number) {
  if (!m.has_cover) return null
  const abs = resolveInside(root, m.path)
  if (!abs) return null

  let folderCover: string | null = null
  let stamp: string
  if (m.has_cover === 2) {
    folderCover = findFolderCover(path.dirname(abs))
    if (!folderCover) return null
    stamp = `f${fs.statSync(folderCover).mtimeMs}`
  } else {
    stamp = `e${m.mtime}`
  }

  const cacheDir = path.join(dataDir, 'covers')
  const key = crypto.createHash('sha1').update(`${folderCover ?? m.path}|${stamp}|${size}`).digest('hex')
  const cacheFile = path.join(cacheDir, `${key}.jpg`)
  try { return fs.readFileSync(cacheFile) } catch { /* no cacheada */ }

  try {
    let src: Uint8Array | null
    if (folderCover) src = fs.readFileSync(folderCover)
    else {
      const meta = await parseFile(abs, { skipPostHeaders: true })
      src = selectCover(meta.common.picture)?.data ?? null
    }
    if (!src) return null
    const out = await sharp(src).rotate().resize(size, size, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer()
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(cacheFile, out)
    return out
  } catch {
    return null
  }
}

export function parseSize(q: unknown): number {
  const n = Number(q)
  return COVER_SIZES.includes(n) ? n : 512
}
