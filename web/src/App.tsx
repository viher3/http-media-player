import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import * as api from './api'
import Player from './components/Player'
import NowPlaying from './components/NowPlaying'
import AddToPlaylistModal from './components/AddToPlaylistModal'
import Browse from './pages/Browse'
import Login from './pages/Auth'
import Users from './pages/Users'
import { Albums, AlbumPage, Artists, ArtistPage, Favorites, GenrePage, Genres, Home, SearchPage, Videos } from './pages/Library'
import { PlaylistPage, Playlists } from './pages/Playlists'
import { useApp, type ThemePref } from './store/app'
import { usePlayer } from './store/player'
import { useShortcuts } from './shortcuts'

function ScanStatusButton() {
  const user = useApp((s) => s.user)
  const scan = useApp((s) => s.scan)
  const setScan = useApp((s) => s.setScan)
  if (!user?.is_admin) return scan?.running ? <span className="muted">Escaneando…</span> : null
  return (
    <button onClick={() => api.startScan().then(setScan).catch(() => {})} disabled={scan?.running}>
      <span aria-hidden>⟳</span><span className="lbl"> {scan?.running ? `Escaneando ${scan.processed}/${scan.total}…` : 'Reescanear'}</span>
    </button>
  )
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useApp((s) => s.showToast)
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="modal" onSubmit={(e) => {
        e.preventDefault()
        api.changePassword(current, pw).then(() => { toast('Contraseña actualizada'); onClose() }).catch((x: Error) => setErr(x.message))
      }}>
        <h3>Cambiar contraseña</h3>
        <label>Actual<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label>Nueva (mín. 8)<input type="password" autoComplete="new-password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="actions"><button className="primary">Guardar</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
    </div>
  )
}

function UserMenu() {
  const user = useApp((s) => s.user)!
  const setUser = useApp((s) => s.setUser)
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const [open, setOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const nav = useNavigate()
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const off = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])

  const signOut = async () => {
    await api.logout().catch(() => {})
    usePlayer.getState().setPlaying(false)
    setUser(null)
  }

  return (
    <div className="menu-wrap" ref={root}>
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label={`Cuenta de ${user.username}`}><span aria-hidden>👤</span><span className="lbl"> {user.username}</span></button>
      {open && (
        <div className="menu right" role="menu">
          <label className="menu-item">Tema{' '}
            <select value={theme} onChange={(e) => setTheme(e.target.value as ThemePref)}>
              <option value="system">Sistema</option><option value="light">Claro</option><option value="dark">Oscuro</option>
            </select>
          </label>
          {user.is_admin && <button role="menuitem" onClick={() => { setOpen(false); nav('/users') }}>Usuarios</button>}
          <button role="menuitem" onClick={() => { setOpen(false); setPwOpen(true) }}>Cambiar contraseña</button>
          <button role="menuitem" onClick={signOut}>Cerrar sesión</button>
        </div>
      )}
      {pwOpen && <PasswordModal onClose={() => setPwOpen(false)} />}
    </div>
  )
}

function SearchBox({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const nav = useNavigate()
  const { pathname, search } = useLocation()
  const [q, setQ] = useState(() => (pathname === '/search' ? new URLSearchParams(search).get('q') ?? '' : ''))
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const go = (v: string, replace: boolean) => nav(`/search?q=${encodeURIComponent(v)}`, { replace })
  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); clearTimeout(timer.current); if (q.trim()) go(q, false) }}>
      <input
        ref={inputRef} type="search" className="search" placeholder="Buscar…  ( / )" aria-label="Buscar" value={q}
        onChange={(e) => {
          setQ(e.target.value)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => { if (e.target.value.trim()) go(e.target.value, pathname === '/search') }, 250)
        }}
      />
    </form>
  )
}

const TABS: [string, string][] = [
  ['/', 'Inicio'], ['/browse', 'Carpetas'], ['/artists', 'Artistas'], ['/albums', 'Álbumes'],
  ['/genres', 'Géneros'], ['/videos', 'Vídeos'], ['/playlists', 'Playlists'], ['/favorites', 'Favoritos'],
]

function Shell() {
  const { pathname } = useLocation()
  const setExpanded = usePlayer((s) => s.setExpanded)
  const toast = useApp((s) => s.toast)
  const searchRef = useRef<HTMLInputElement>(null)
  useShortcuts(() => searchRef.current?.focus())

  // Al navegar, el vídeo pasa a mini-ventana sin interrumpir la reproducción
  useEffect(() => { setExpanded(false); usePlayer.getState().setNowPlaying(false) }, [pathname])

  // Favoritos del usuario y canal de eventos del servidor (estado de escaneo / biblioteca actualizada)
  useEffect(() => {
    api.favoriteIds().then((ids) => usePlayer.getState().setFavorites(ids)).catch(() => {})
    const es = new EventSource('/api/events')
    es.addEventListener('scan', (e) => useApp.getState().setScan(JSON.parse((e as MessageEvent).data)))
    es.addEventListener('library', () => useApp.getState().bumpLibrary())
    return () => es.close()
  }, [])

  return (
    <div className="app">
      <header className="top">
        <Link to="/" className="brand">▶ Media Player</Link>
        <SearchBox inputRef={searchRef} />
        <span className="spacer" />
        <ScanStatusButton />
        <UserMenu />
      </header>
      <nav className="tabs-nav" aria-label="Biblioteca">
        {TABS.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'sel' : '')}>{label}</NavLink>
        ))}
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/browse/*" element={<Browse />} />
          <Route path="/artists" element={<Artists />} />
          <Route path="/artists/:id" element={<ArtistPage />} />
          <Route path="/albums" element={<Albums />} />
          <Route path="/albums/:id" element={<AlbumPage />} />
          <Route path="/genres" element={<Genres />} />
          <Route path="/genres/:name" element={<GenrePage />} />
          <Route path="/videos" element={<Videos />} />
          <Route path="/playlists" element={<Playlists />} />
          <Route path="/playlists/:id" element={<PlaylistPage />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/users" element={<Users />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <NowPlaying />
      <AddToPlaylistModal />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

export default function App() {
  const user = useApp((s) => s.user)
  const setUser = useApp((s) => s.setUser)
  const setSetupRequired = useApp((s) => s.setSetupRequired)

  useEffect(() => {
    api.setUnauthorizedHandler(() => setUser(null))
    api.me().then(setUser).catch(async () => {
      try { setSetupRequired((await api.authStatus()).setupRequired) } catch { /* ignore */ }
      setUser(null)
    })
  }, [])

  useEffect(() => {
    // Al cerrar sesión se detiene y vacía la reproducción
    if (user === null) { usePlayer.setState({ playing: false, queue: [], index: -1, nowPlayingOpen: false, expanded: false, favorites: new Set() }); usePlayer.getState().setNowPlaying(false) }
    if (user === null) api.authStatus().then((s) => setSetupRequired(s.setupRequired)).catch(() => {})
  }, [user])

  if (user === undefined) return <p className="msg center-msg">Cargando…</p>
  return (
    <>
      {user ? <Shell /> : <Login />}
      {/* El reproductor vive fuera del router y de Shell: nunca se desmonta al navegar */}
      <Player hidden={!user} />
    </>
  )
}
