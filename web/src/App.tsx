import { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Browse from './pages/Browse'
import Player from './components/Player'
import { fetchScanStatus, startScan, type ScanStatus } from './api'
import { usePlayer } from './store/player'

function ScanButton() {
  const [st, setSt] = useState<ScanStatus | null>(null)
  const bump = usePlayer((s) => s.bumpLibrary)

  useEffect(() => {
    if (!st?.running) return
    const t = setInterval(() => {
      fetchScanStatus().then((n) => {
        setSt(n)
        if (!n.running) bump()
      }).catch(() => {})
    }, 700)
    return () => clearInterval(t)
  }, [st?.running])

  // Al abrir, comprobar si el escaneo inicial sigue en curso
  useEffect(() => { fetchScanStatus().then(setSt).catch(() => {}) }, [])

  return (
    <button onClick={() => startScan().then(setSt)} disabled={st?.running}>
      {st?.running ? `Escaneando ${st.processed}/${st.total}…` : '⟳ Reescanear'}
    </button>
  )
}

export default function App() {
  const { pathname } = useLocation()
  const setExpanded = usePlayer((s) => s.setExpanded)
  // Al navegar, el vídeo pasa a mini-ventana sin interrumpir la reproducción
  useEffect(() => { setExpanded(false) }, [pathname])

  return (
    <div className="app">
      <header className="top">
        <Link to="/browse" className="brand">▶ Media Player</Link>
        <ScanButton />
      </header>
      <main className="content">
        <Routes>
          <Route path="/browse/*" element={<Browse />} />
          <Route path="*" element={<Navigate to="/browse" replace />} />
        </Routes>
      </main>
      <Player />
    </div>
  )
}
