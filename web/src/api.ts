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
  album_artist?: string | null
  album: string | null
  track_no: number | null
  year?: number | null
  genre?: string | null
  has_cover: number
  artist_id?: number | null
  album_id?: number | null
}

export type FolderPayload = {
  folder: { id: number; path: string; name: string }
  breadcrumb: { id: number; name: string; path: string }[]
  folders: { id: number; name: string; path: string; media_count: number }[]
  media: MediaItem[]
}

export type AlbumSummary = {
  id: number; title: string; year: number | null; artist_id: number | null
  artist_name: string | null; has_cover: number; track_count: number
}
export type ArtistSummary = { id: number; name: string; album_count: number; track_count: number; cover_album_id: number | null }
export type PlaylistSummary = { id: number; name: string; updated_at: number; track_count: number; cover_media_id: number | null }
export type PlaylistItem = {
  item_id: number; position: number; available: boolean; media: MediaItem | null
  title: string; artist: string | null
}
export type ScanStatus = { running: boolean; processed: number; total: number; errors: number }
export type User = { id: number; username: string; is_admin: boolean }
export type Lyrics = { synced: { t: number; text: string }[] | null; text: string | null }
export type Subtitle = { name: string; lang: string; label: string }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    let msg = r.status === 404 ? 'No encontrado' : `Error ${r.status}`
    try { msg = (await r.json()).error ?? msg } catch { /* sin cuerpo */ }
    if (r.status === 401 && !url.startsWith('/api/auth/')) onUnauthorized()
    throw new ApiError(r.status, msg)
  }
  const text = await r.text()
  return (text ? JSON.parse(text) : undefined) as T
}
const get = <T>(url: string) => request<T>('GET', url)

// --- auth
export const authStatus = () => get<{ setupRequired: boolean }>('/api/auth/status')
export const me = () => get<User>('/api/auth/me')
export const login = (username: string, password: string) => request<User>('POST', '/api/auth/login', { username, password })
export const setup = (username: string, password: string) => request<User>('POST', '/api/auth/setup', { username, password })
export const logout = () => request<void>('POST', '/api/auth/logout')
export const changePassword = (current: string, password: string) => request<void>('POST', '/api/auth/password', { current, password })
export const listUsers = () => get<(User & { created_at: number })[]>('/api/users')
export const createUser = (username: string, password: string, is_admin: boolean) =>
  request<User>('POST', '/api/users', { username, password, is_admin })
export const deleteUser = (id: number) => request<void>('DELETE', `/api/users/${id}`)

// --- biblioteca
export const fetchFolder = (path: string) =>
  path ? get<FolderPayload>(`/api/folders/by-path?p=${encodeURIComponent(path)}`) : get<FolderPayload>('/api/folders')
export const startScan = () => request<ScanStatus>('POST', '/api/scan')
export const fetchScanStatus = () => get<ScanStatus>('/api/scan/status')
export const artists = () => get<ArtistSummary[]>('/api/artists')
export const artist = (id: number) =>
  get<{ artist: { id: number; name: string }; albums: AlbumSummary[]; singles: MediaItem[] }>(`/api/artists/${id}`)
export const albums = (sort?: 'year' | 'recent') => get<AlbumSummary[]>(`/api/albums${sort ? `?sort=${sort}` : ''}`)
export const album = (id: number) => get<{ album: AlbumSummary; tracks: MediaItem[] }>(`/api/albums/${id}`)
export const genres = () => get<{ name: string; track_count: number }[]>('/api/genres')
export const genre = (name: string) => get<{ name: string; tracks: MediaItem[] }>(`/api/genres/${encodeURIComponent(name)}`)
export const videos = () => get<(MediaItem & { folder_path: string })[]>('/api/videos')
export const search = (q: string) =>
  get<{ media: MediaItem[]; albums: AlbumSummary[]; artists: { id: number; name: string }[] }>(`/api/search?q=${encodeURIComponent(q)}`)
export const recentlyAdded = () => get<MediaItem[]>('/api/lists/recently-added')
export const recentlyPlayed = () => get<MediaItem[]>('/api/lists/recently-played')
export const mostPlayed = () => get<MediaItem[]>('/api/lists/most-played')
export const lyrics = (id: number) => get<Lyrics>(`/api/media/${id}/lyrics`)
export const subtitles = (id: number) => get<Subtitle[]>(`/api/media/${id}/subtitles`)

// --- estado de usuario
export const favorites = () => get<MediaItem[]>('/api/favorites')
export const favoriteIds = () => get<number[]>('/api/favorites/ids')
export const setFavorite = (id: number, on: boolean) => request<void>(on ? 'PUT' : 'DELETE', `/api/favorites/${id}`)
export const recordPlay = (id: number) => request<void>('POST', '/api/history', { media_id: id })
export const getResume = (id: number) => get<{ position_ms: number }>(`/api/resume/${id}`)
export const putResume = (id: number, position_ms: number, duration_ms: number) =>
  request<void>('PUT', `/api/resume/${id}`, { position_ms, duration_ms })

// --- playlists
export const playlists = () => get<PlaylistSummary[]>('/api/playlists')
export const playlist = (id: number) =>
  get<{ playlist: { id: number; name: string; updated_at: number }; items: PlaylistItem[] }>(`/api/playlists/${id}`)
export const createPlaylist = (name: string, media_ids: number[] = []) =>
  request<{ id: number; name: string }>('POST', '/api/playlists', { name, media_ids })
export const renamePlaylist = (id: number, name: string) => request<void>('PATCH', `/api/playlists/${id}`, { name })
export const deletePlaylist = (id: number) => request<void>('DELETE', `/api/playlists/${id}`)
export const addToPlaylist = (id: number, media_ids: number[]) =>
  request<{ added: number }>('POST', `/api/playlists/${id}/items`, { media_ids })
export const removeFromPlaylist = (id: number, itemId: number) => request<void>('DELETE', `/api/playlists/${id}/items/${itemId}`)
export const reorderPlaylist = (id: number, item_ids: number[]) => request<void>('PUT', `/api/playlists/${id}/order`, { item_ids })
export const importPlaylist = (name: string, m3u: string) =>
  request<{ id: number; matched: number; missing: number }>('POST', '/api/playlists/import', { name, m3u })
export const exportPlaylistUrl = (id: number) => `/api/playlists/${id}/export.m3u8`

// --- URLs
export const streamUrl = (id: number) => `/api/media/${id}/stream`
export const coverUrl = (id: number, size = 256) => `/api/media/${id}/cover?size=${size}`
export const albumCoverUrl = (id: number, size = 256) => `/api/albums/${id}/cover?size=${size}`
export const subtitleUrl = (id: number, name: string) => `/api/media/${id}/subtitles/${encodeURIComponent(name)}`

// --- formato
export const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`
}
export const fmtSize = (b: number) =>
  b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`
export const titleOf = (m: MediaItem) => m.title || m.filename
export const browseLink = (p: string) => '/browse' + (p ? '/' + p.split('/').map(encodeURIComponent).join('/') : '')
