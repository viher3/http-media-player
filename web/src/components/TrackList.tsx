import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtSize, fmtTime, setFavorite, titleOf, type MediaItem } from '../api'
import { usePlayer } from '../store/player'
import { useApp } from '../store/app'

export function useToggleFavorite() {
  const favs = usePlayer((s) => s.favorites)
  const toggleLocal = usePlayer((s) => s.toggleFavoriteLocal)
  return (id: number) => {
    const on = !favs.has(id)
    toggleLocal(id, on)
    setFavorite(id, on).catch(() => toggleLocal(id, !on))
  }
}

function TrackMenu({ item }: { item: MediaItem }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const { playNext, addToQueue } = usePlayer.getState()
  const pick = useApp((s) => s.openPlaylistPicker)
  const toast = useApp((s) => s.showToast)

  useEffect(() => {
    if (!open) return
    const off = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])

  const act = (fn: () => void) => () => { setOpen(false); fn() }
  return (
    <span className="menu-wrap" ref={root}>
      <button className="icon" onClick={(e) => { e.stopPropagation(); setOpen(!open) }} aria-haspopup="menu" aria-expanded={open} aria-label="Más opciones">⋯</button>
      {open && (
        <div className="menu" role="menu" onClick={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={act(() => { playNext([item]); toast('Se reproducirá a continuación') })}>Reproducir a continuación</button>
          <button role="menuitem" onClick={act(() => { addToQueue([item]); toast('Añadida a la cola') })}>Añadir a la cola</button>
          <button role="menuitem" onClick={act(() => pick([item.id]))}>Añadir a playlist…</button>
          {item.artist_id ? <Link role="menuitem" to={`/artists/${item.artist_id}`}>Ir al artista</Link> : null}
          {item.album_id ? <Link role="menuitem" to={`/albums/${item.album_id}`}>Ir al álbum</Link> : null}
        </div>
      )}
    </span>
  )
}

export type TrackListProps = {
  items: MediaItem[]
  /** 'track' = nº de pista del álbum; 'index' = posición en la lista */
  numbering?: 'track' | 'index' | 'none'
  showAlbum?: boolean
  showSize?: boolean
  /** Sustituye la acción de reproducir (por defecto: cola con toda la lista) */
  onPlay?: (index: number) => void
}

/** Lista de pistas reutilizable: reproducir, favorito, menú contextual. */
export default function TrackList({ items, numbering = 'index', showAlbum = false, showSize = false, onPlay }: TrackListProps) {
  const current = usePlayer((s) => (s.index >= 0 ? s.queue[s.index] : null))
  const playing = usePlayer((s) => s.playing)
  const favs = usePlayer((s) => s.favorites)
  const playQueue = usePlayer((s) => s.playQueue)
  const toggleFav = useToggleFavorite()

  if (!items.length) return null
  return (
    <ul className="list tracks">
      {items.map((m, i) => {
        const active = current?.id === m.id
        const num = numbering === 'track' ? (m.track_no ?? '') : numbering === 'index' ? i + 1 : null
        return (
          <li key={`${i}-${m.id}`} className={`trow ${active ? 'active' : ''}`}>
            <button className="row" onClick={() => (onPlay ? onPlay(i) : playQueue(items, i))}>
              <span className="ico">{active && playing ? '🔊' : num !== null && m.kind === 'audio' ? num : m.kind === 'video' ? '🎬' : '🎵'}</span>
              <span className="name">
                {titleOf(m)}
                {m.artist && <small> · {m.artist}</small>}
              </span>
              {showAlbum && <span className="album">{m.album ?? ''}</span>}
              <span className="meta">{m.duration_ms ? fmtTime(m.duration_ms / 1000) : '–'}{showSize ? ` · ${fmtSize(m.size)}` : ''}</span>
            </button>
            <button className={`icon fav ${favs.has(m.id) ? 'on' : ''}`} onClick={() => toggleFav(m.id)}
              aria-pressed={favs.has(m.id)} aria-label={favs.has(m.id) ? 'Quitar de favoritos' : 'Añadir a favoritos'}>
              {favs.has(m.id) ? '♥' : '♡'}
            </button>
            <TrackMenu item={m} />
          </li>
        )
      })}
    </ul>
  )
}
