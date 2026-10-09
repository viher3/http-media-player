import { create } from 'zustand'
import type { ScanStatus, User } from '../api'

export type ThemePref = 'system' | 'light' | 'dark'

const THEME_KEY = 'hmp.theme'
const readTheme = (): ThemePref => {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch { return 'system' }
}

export function applyTheme(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#121212' : '#ffffff')
}

type AppState = {
  /** undefined = comprobando sesión; null = sin sesión */
  user: User | null | undefined
  setupRequired: boolean
  scan: ScanStatus | null
  libraryVersion: number
  theme: ThemePref
  /** ids de medios para los que se abre el selector "Añadir a playlist" */
  playlistPicker: number[] | null
  toast: string | null

  setUser: (u: User | null) => void
  setSetupRequired: (b: boolean) => void
  setScan: (s: ScanStatus) => void
  bumpLibrary: () => void
  setTheme: (t: ThemePref) => void
  openPlaylistPicker: (ids: number[] | null) => void
  showToast: (msg: string) => void
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useApp = create<AppState>((set, get) => ({
  user: undefined,
  setupRequired: false,
  scan: null,
  libraryVersion: 0,
  theme: readTheme(),
  playlistPicker: null,
  toast: null,

  setUser: (user) => set({ user }),
  setSetupRequired: (setupRequired) => set({ setupRequired }),
  setScan: (scan) => set({ scan }),
  bumpLibrary: () => set({ libraryVersion: get().libraryVersion + 1 }),
  setTheme: (theme) => {
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
    applyTheme(theme)
    set({ theme })
  },
  openPlaylistPicker: (playlistPicker) => set({ playlistPicker }),
  showToast: (toast) => {
    clearTimeout(toastTimer)
    set({ toast })
    toastTimer = setTimeout(() => set({ toast: null }), 2500)
  },
}))
