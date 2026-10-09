import type { ReactNode } from 'react'

export function PageState({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  if (error) return <p className="msg err">{error}</p>
  if (loading) return <p className="msg">Cargando…</p>
  return <>{children}</>
}

export function PlayAllButtons({ onPlay, onShuffle }: { onPlay: () => void; onShuffle: () => void }) {
  return (
    <div className="actions">
      <button className="primary" onClick={onPlay}>▶ Reproducir</button>
      <button className="secondary" onClick={onShuffle}>🔀 Aleatorio</button>
    </div>
  )
}
