export type MediaItem = {
  id: number
  folder_id: number
  filename: string
  kind: 'audio' | 'video'
  mime: string
  size: number
  duration_ms: number | null
  title: string | null
  artist: string | null
  album: string | null
  track_no: number | null
  has_cover: number
}

export type FolderPayload = {
  folder: { id: number; path: string; name: string }
  breadcrumb: { id: number; name: string; path: string }[]
  folders: { id: number; name: string; path: string; media_count: number }[]
  media: MediaItem[]
}

export type ScanStatus = { running: boolean; processed: number; total: number; errors: number }

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(r.status === 404 ? 'No encontrado' : `Error ${r.status}`)
  return r.json()
}

export const fetchFolder = (path: string) =>
  path ? get<FolderPayload>(`/api/folders/by-path?p=${encodeURIComponent(path)}`) : get<FolderPayload>('/api/folders')
export const fetchScanStatus = () => get<ScanStatus>('/api/scan/status')
export const startScan = () => fetch('/api/scan', { method: 'POST' }).then((r) => r.json() as Promise<ScanStatus>)
export const streamUrl = (id: number) => `/api/media/${id}/stream`
export const coverUrl = (id: number) => `/api/media/${id}/cover`

export const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`
}
export const fmtSize = (b: number) =>
  b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`
export const titleOf = (m: MediaItem) => m.title || m.filename
