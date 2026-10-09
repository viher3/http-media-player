import { create } from 'zustand'
import type { MediaItem } from '../api'

const KEY = 'hmp.player.v1'

type Saved = { queue: MediaItem[]; index: number; time: number; volume: number; muted: boolean }

function load(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch { /* almacenamiento no disponible */ }
}

type State = {
  queue: MediaItem[]
  index: number
  playing: boolean
  /** true si al cambiar de pista debe reproducirse (false al restaurar sesión) */
  autoplay: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  expanded: boolean
  error: string | null
  /** petición de seek pendiente, consumida por <Player/> */
  seekTo: number | null
  /** contador para refrescar listados tras un reescaneo */
  libraryVersion: number
  /** posición a aplicar al cargar la pista restaurada */
  resumeAt: number

  playQueue: (items: MediaItem[], start: number) => void
  next: () => void
  prev: () => void
  setPlaying: (p: boolean) => void
  toggle: () => void
  seek: (t: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  setExpanded: (e: boolean) => void
  bumpLibrary: () => void
}

const saved = load()
const restoredQueue = Array.isArray(saved.queue) ? saved.queue : []
const restoredIndex = restoredQueue.length ? Math.min(Math.max(saved.index ?? 0, 0), restoredQueue.length - 1) : -1

export const usePlayer = create<State>((set, get) => ({
  queue: restoredQueue,
  index: restoredIndex,
  playing: false,
  autoplay: false,
  currentTime: saved.time ?? 0,
  duration: 0,
  volume: saved.volume ?? 1,
  muted: saved.muted ?? false,
  expanded: false,
  error: null,
  seekTo: null,
  libraryVersion: 0,
  resumeAt: saved.time ?? 0,

  playQueue: (items, start) =>
    set({
      queue: items, index: start, autoplay: true, playing: true, error: null, resumeAt: 0,
      currentTime: 0, expanded: items[start]?.kind === 'video',
    }),
  next: () => {
    const { index, queue } = get()
    if (index < queue.length - 1) set({ index: index + 1, autoplay: true, playing: true, error: null, resumeAt: 0, currentTime: 0 })
    else set({ playing: false })
  },
  prev: () => {
    const { index, currentTime } = get()
    if (currentTime > 3 || index === 0) set({ seekTo: 0 })
    else set({ index: index - 1, autoplay: true, playing: true, error: null, resumeAt: 0, currentTime: 0 })
  },
  setPlaying: (playing) => set({ playing }),
  toggle: () => {
    if (get().index >= 0) set({ playing: !get().playing, autoplay: true })
  },
  seek: (t) => set({ seekTo: t, currentTime: t }),
  setVolume: (volume) => set({ volume, muted: false }),
  toggleMute: () => set({ muted: !get().muted }),
  setExpanded: (expanded) => set({ expanded }),
  bumpLibrary: () => set({ libraryVersion: get().libraryVersion + 1 }),
}))
