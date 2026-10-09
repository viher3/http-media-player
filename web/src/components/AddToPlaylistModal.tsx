import { useEffect, useState } from 'react'
import { addToPlaylist, createPlaylist, playlists, type PlaylistSummary } from '../api'
import { useApp } from '../store/app'

export default function AddToPlaylistModal() {
  const ids = useApp((s) => s.playlistPicker)
  const close = useApp((s) => s.openPlaylistPicker)
  const toast = useApp((s) => s.showToast)
  const bump = useApp((s) => s.bumpLibrary)
  const [list, setList] = useState<PlaylistSummary[]>([])
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!ids) return
    setName(''); setErr(null)
    playlists().then(setList).catch((e: Error) => setErr(e.message))
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(null) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [ids])

  if (!ids) return null

  const done = (msg: string) => { toast(msg); bump(); close(null) }
  const add = (p: PlaylistSummary) =>
    addToPlaylist(p.id, ids).then((r) => done(`${r.added} añadida(s) a «${p.name}»`)).catch((e: Error) => setErr(e.message))
  const create = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    createPlaylist(name.trim(), ids).then((p) => done(`Playlist «${p.name}» creada`)).catch((e: Error) => setErr(e.message))
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(null) }}>
      <div className="modal" role="dialog" aria-label="Añadir a playlist">
        <h3>Añadir a playlist</h3>
        <form onSubmit={create} className="inline-form">
          <input autoFocus placeholder="Nueva playlist…" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          <button className="primary" disabled={!name.trim()}>Crear</button>
        </form>
        {err && <p className="err">{err}</p>}
        <ul className="list">
          {list.map((p) => (
            <li key={p.id}><button className="row" onClick={() => add(p)}><span className="ico">🎶</span><span className="name">{p.name}</span><span className="meta">{p.track_count}</span></button></li>
          ))}
        </ul>
        <button onClick={() => close(null)}>Cancelar</button>
      </div>
    </div>
  )
}
