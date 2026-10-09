import chokidar from 'chokidar'
import type { Db } from './db.js'
import { scan, scanStatus, scanEvents } from './scanner.js'
import { AUDIO_EXT, VIDEO_EXT } from './config.js'
import path from 'node:path'

const DEBOUNCE_MS = Number(process.env.WATCH_DEBOUNCE_MS ?? 3000)

/**
 * Vigila MEDIA_DIR y lanza un reescaneo incremental tras un periodo de calma.
 * WATCH_POLLING=1 usa polling (necesario en volúmenes de red donde inotify no funciona).
 */
export function startWatcher(db: Db, root: string) {
  if (process.env.WATCH === '0') return null
  let timer: NodeJS.Timeout | null = null
  let again = false

  const run = () => {
    if (scanStatus.running) { again = true; return }
    scan(db, root).catch((e) => console.error('[watch] scan', e))
  }
  scanEvents.on('done', () => { if (again) { again = false; run() } })

  const trigger = (file: string) => {
    const ext = path.extname(file).slice(1).toLowerCase()
    // Medios, carátulas, subtítulos y letras relevantes; también carpetas (sin extensión)
    if (ext && !AUDIO_EXT.has(ext) && !VIDEO_EXT.has(ext) && !['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, DEBOUNCE_MS)
  }

  const w = chokidar.watch(root, {
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
    usePolling: process.env.WATCH_POLLING === '1',
    interval: Number(process.env.WATCH_POLL_INTERVAL_MS ?? 5000),
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 250 },
    ignored: (p) => path.basename(p).startsWith('.'),
  })
  for (const ev of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) w.on(ev, trigger)
  w.on('error', (e) => console.warn('[watch]', e))
  return w
}
