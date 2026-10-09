import fs from 'node:fs'
import path from 'node:path'

export type Subtitle = { name: string; lang: string; label: string }

/** Subtítulos junto al vídeo: <base>.srt|vtt o <base>.<lang>.srt|vtt */
export function listSubtitles(absMedia: string): Subtitle[] {
  const dir = path.dirname(absMedia)
  const base = path.basename(absMedia, path.extname(absMedia)).toLowerCase()
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out: Subtitle[] = []
  for (const name of names.sort()) {
    const ext = path.extname(name).toLowerCase()
    if (ext !== '.srt' && ext !== '.vtt') continue
    const stem = name.slice(0, -ext.length)
    const lower = stem.toLowerCase()
    if (lower !== base && !lower.startsWith(base + '.')) continue
    const lang = lower === base ? '' : stem.slice(base.length + 1)
    out.push({ name, lang, label: lang || 'Subtítulos' })
  }
  return out
}

export function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

export function srtToVtt(text: string): string {
  const body = text.replace(/\r\n?/g, '\n').replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return body.startsWith('WEBVTT') ? body : `WEBVTT\n\n${body.trim()}\n`
}

export type LyricLine = { t: number; text: string }

/** Parsea LRC. Devuelve null si no contiene marcas de tiempo. */
export function parseLrc(text: string): LyricLine[] | null {
  const lines: LyricLine[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (!stamps.length) continue
    const content = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const m of stamps) {
      const frac = m[3] ? Number(`0.${m[3]}`) : 0
      lines.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text: content })
    }
  }
  return lines.length ? lines.sort((a, b) => a.t - b.t) : null
}
