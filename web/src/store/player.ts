import { create } from 'zustand'
import type { MediaItem } from '../api'

const KEY = 'hmp.player.v2'

export type RepeatMode = 'off' | 'all' | 'one'

type Saved = {
  queue: MediaItem[]; index: number; time: number; volume: number; muted: boolean
  shuffle: boolean; repeat: RepeatMode; unshuffled: MediaItem[] | null
}

function load(): Partial<Saved> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}

export function save(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* almacenamiento no disponible */ }
}

export function shuffled<T>(a: T[]): T[] {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

type State = {
  queue: MediaItem[]
  index: number
  /** copia del orden original mientras shuffle está activo */
  unshuffled: MediaItem[] | null
  shuffle: boolean
  repeat: RepeatMode
  playing: boolean
  /** true si al cambiar de pista debe reproducirse (false al restaurar sesión) */
  autoplay: boolean
  /** se incrementa en cada petición de reproducir una posición de la cola */
  playToken: number
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  expanded: boolean
  nowPlayingOpen: boolean
  error: string | null
  seekTo: number | null
  resumeAt: number
  favorites: Set<number>

  playQueue: (items: MediaItem[], start?: number, opts?: { shuffle?: boolean }) => void
  jumpTo: (i: number) => void
  next: () => void
  prev: () => void
  setPlaying: (p: boolean) => void
  toggle: () => void
  seek: (t: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  setExpanded: (e: boolean) => void
  setNowPlaying: (o: boolean) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  playNext: (items: MediaItem[]) => void
  addToQueue: (items: MediaItem[]) => void
  removeAt: (i: number) => void
  moveInQueue: (from: number, to: number) => void
  clearQueue: () => void
  setFavorites: (ids: number[]) => void
  toggleFavoriteLocal: (id: number, on: boolean) => void
}

const saved = load()
const restoredQueue = Array.isArray(saved.queue) ? saved.queue : []
const restoredIndex = restoredQueue.length ? Math.min(Math.max(saved.index ?? 0, 0), restoredQueue.length - 1) : -1

const started = { autoplay: true, playing: true, error: null, resumeAt: 0, currentTime: 0 }

export const usePlayer = create<State>((set, get) => ({
  queue: restoredQueue,
  index: restoredIndex,
  unshuffled: saved.unshuffled ?? null,
  shuffle: !!saved.shuffle,
  repeat: saved.repeat === 'all' || saved.repeat === 'one' ? saved.repeat : 'off',
  playing: false,
  autoplay: false,
  playToken: 0,
  currentTime: saved.time ?? 0,
  duration: 0,
  volume: saved.volume ?? 1,
  muted: saved.muted ?? false,
  expanded: false,
  nowPlayingOpen: false,
  error: null,
  seekTo: null,
  resumeAt: saved.time ?? 0,
  favorites: new Set(),

  playQueue: (items, start = 0, opts) => {
    if (!items.length) return
    const shuffle = opts?.shuffle ?? get().shuffle
    const startIdx = opts?.shuffle ? Math.floor(Math.random() * items.length) : start
    let queue = items, index = startIdx, unshuffled: MediaItem[] | null = null
    if (shuffle) {
      unshuffled = items
      queue = [items[startIdx], ...shuffled(items.filter((_, i) => i !== startIdx))]
      index = 0
    }
    set({
      queue, index, unshuffled, shuffle, ...started, playToken: get().playToken + 1,
      expanded: queue[index]?.kind === 'video',
    })
  },
  jumpTo: (i) => {
    if (i < 0 || i >= get().queue.length) return
    set({ index: i, ...started, playToken: get().playToken + 1, expanded: get().queue[i].kind === 'video' })
  },
  next: () => {
    const { index, queue, repeat, playToken } = get()
    if (index < queue.length - 1) set({ index: index + 1, ...started, playToken: playToken + 1 })
    else if (repeat === 'all' && queue.length) set({ index: 0, ...started, playToken: playToken + 1 })
    else set({ playing: false })
  },
  prev: () => {
    const { index, currentTime, queue, repeat, playToken } = get()
    if (currentTime > 3 || (index === 0 && repeat !== 'all')) set({ seekTo: 0 })
    else set({ index: index > 0 ? index - 1 : queue.length - 1, ...started, playToken: playToken + 1 })
  },
  setPlaying: (playing) => set({ playing }),
  toggle: () => { if (get().index >= 0) set({ playing: !get().playing, autoplay: true }) },
  seek: (t) => set({ seekTo: t, currentTime: t }),
  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)), muted: false }),
  toggleMute: () => set({ muted: !get().muted }),
  setExpanded: (expanded) => set({ expanded }),
  setNowPlaying: (nowPlayingOpen) => set({ nowPlayingOpen }),

  toggleShuffle: () => {
    const { shuffle, queue, index, unshuffled } = get()
    if (!shuffle) {
      if (index < 0) return set({ shuffle: true })
      const cur = queue[index]
      set({
        shuffle: true, unshuffled: queue,
        queue: [cur, ...shuffled(queue.filter((_, i) => i !== index))], index: 0,
      })
    } else {
      const orig = unshuffled ?? queue
      const cur = queue[index]
      const at = cur ? orig.findIndex((m) => m.id === cur.id) : -1
      set({ shuffle: false, unshuffled: null, queue: orig, index: at >= 0 ? at : Math.min(index, orig.length - 1) })
    }
  },
  cycleRepeat: () => set({ repeat: ({ off: 'all', all: 'one', one: 'off' } as const)[get().repeat] }),

  playNext: (items) => {
    const { queue, index, unshuffled } = get()
    if (!queue.length) return get().playQueue(items, 0)
    const q = [...queue]
    q.splice(index + 1, 0, ...items)
    set({ queue: q, unshuffled: unshuffled ? [...unshuffled, ...items] : null })
  },
  addToQueue: (items) => {
    const { queue, unshuffled } = get()
    if (!queue.length) return get().playQueue(items, 0)
    set({ queue: [...queue, ...items], unshuffled: unshuffled ? [...unshuffled, ...items] : null })
  },
  removeAt: (i) => {
    const { queue, index } = get()
    if (i === index || i < 0 || i >= queue.length) return
    const q = queue.filter((_, k) => k !== i)
    set({ queue: q, index: i < index ? index - 1 : index })
  },
  moveInQueue: (from, to) => {
    const { queue, index } = get()
    if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return
    const q = [...queue]
    const [it] = q.splice(from, 1)
    q.splice(to, 0, it)
    let idx = index
    if (from === index) idx = to
    else if (from < index && to >= index) idx = index - 1
    else if (from > index && to <= index) idx = index + 1
    set({ queue: q, index: idx })
  },
  clearQueue: () => {
    const { queue, index } = get()
    const cur = queue[index]
    set({ queue: cur ? [cur] : [], index: cur ? 0 : -1, unshuffled: null, shuffle: get().shuffle })
  },

  setFavorites: (ids) => set({ favorites: new Set(ids) }),
  toggleFavoriteLocal: (id, on) => {
    const f = new Set(get().favorites)
    if (on) f.add(id); else f.delete(id)
    set({ favorites: f })
  },
}))
