import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as api from '../api'
import { coverUrl, fmtTime } from '../api'
import { useFetch } from '../hooks'
import { useApp } from '../store/app'
import { usePlayer } from '../store/player'
import Cover from '../components/Cover'
import { PageState, PlayAllButtons } from '../components/Section'

export function Playlists() {
  const { data, error, loading, reload } = useFetch(api.playlists, [])
  const nav = useNavigate()
  const toast = useApp((s) => s.showToast)
  const [name, setName] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const create = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    api.createPlaylist(name.trim()).then((p) => nav(`/playlists/${p.id}`)).catch((e: Error) => toast(e.message))
  }
  const onImport = async (f: File | undefined) => {
    if (!f) return
    try {
      const r = await api.importPlaylist(f.name.replace(/\.[^.]+$/, '') || 'Importada', await f.text())
      toast(`Importada: ${r.matched} pistas${r.missing ? `, ${r.missing} no encontradas` : ''}`)
      nav(`/playlists/${r.id}`)
    } catch (e) { toast((e as Error).message); reload() }
    if (file.current) file.current.value = ''
  }

  return (
    <div>
      <h2>Playlists</h2>
      <div className="actions">
        <form onSubmit={create} className="inline-form">
          <input placeholder="Nueva playlist…" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          <button className="primary" disabled={!name.trim()}>Crear</button>
        </form>
        <button className="secondary" onClick={() => file.current?.click()}>Importar .m3u8</button>
        <input ref={file} type="file" accept=".m3u,.m3u8,audio/x-mpegurl" hidden onChange={(e) => onImport(e.target.files?.[0])} />
      </div>
      <PageState loading={loading && !data} error={error}>
        {data?.length === 0 && <p className="msg">Aún no tienes playlists.</p>}
        <div className="grid">
          {data?.map((p) => (
            <Link key={p.id} to={`/playlists/${p.id}`} className="card">
              <Cover src={p.cover_media_id ? coverUrl(p.cover_media_id, 256) : null} fallback="🎶" />
              <div className="card-title">{p.name}</div>
              <div className="card-sub">{p.track_count} pistas</div>
            </Link>
          ))}
        </div>
      </PageState>
    </div>
  )
}

export function PlaylistPage() {
  const id = Number(useParams().id)
  const nav = useNavigate()
  const toast = useApp((s) => s.showToast)
  const { data, error, loading, reload } = useFetch(() => api.playlist(id), [id])
  const playQueue = usePlayer((s) => s.playQueue)
  const current = usePlayer((s) => (s.index >= 0 ? s.queue[s.index] : null))
  const favs = usePlayer((s) => s.favorites)
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // orden optimista mientras se confirma en el servidor
  const [local, setLocal] = useState<api.PlaylistItem[] | null>(null)
  useEffect(() => setLocal(null), [data])
  const items = local ?? data?.items ?? []
  const playable = items.filter((i) => i.media).map((i) => i.media!)

  const fail = (e: Error) => { toast(e.message); setLocal(null); reload() }

  const drop = (to: number) => {
    if (drag === null || drag === to) return
    const next = [...items]
    const [it] = next.splice(drag, 1)
    next.splice(to, 0, it)
    setLocal(next)
    api.reorderPlaylist(id, next.map((i) => i.item_id)).then(reload).catch(fail)
  }
  const remove = (itemId: number) => api.removeFromPlaylist(id, itemId).then(reload).catch(fail)
  const rename = () => {
    if (renaming?.trim()) api.renamePlaylist(id, renaming.trim()).then(() => { setRenaming(null); reload() }).catch(fail)
    else setRenaming(null)
  }
  const del = () => {
    if (confirm(`¿Borrar la playlist «${data?.playlist.name}»?`)) api.deletePlaylist(id).then(() => nav('/playlists')).catch(fail)
  }

  return (
    <PageState loading={loading && !data} error={error}>
      {data && (
        <div>
          <div className="head-row">
            {renaming === null ? (
              <h2>{data.playlist.name}</h2>
            ) : (
              <form className="inline-form" onSubmit={(e) => { e.preventDefault(); rename() }}>
                <input autoFocus value={renaming} maxLength={100} onChange={(e) => setRenaming(e.target.value)} onBlur={rename} />
              </form>
            )}
            <span className="head-actions">
              <button onClick={() => setRenaming(data.playlist.name)}>Renombrar</button>
              <a className="btn" href={api.exportPlaylistUrl(id)} download>Exportar .m3u8</a>
              <button onClick={del}>Borrar</button>
            </span>
          </div>
          {playable.length > 0 && (
            <PlayAllButtons onPlay={() => playQueue(playable, 0)} onShuffle={() => playQueue(playable, 0, { shuffle: true })} />
          )}
          {items.length === 0 && <p className="msg">Playlist vacía. Usa «⋯ → Añadir a playlist» en cualquier pista.</p>}
          <ul className="list tracks">
            {items.map((it, i) => {
              const m = it.media
              const active = !!m && current?.id === m.id
              return (
                <li
                  key={it.item_id}
                  className={`trow ${active ? 'active' : ''} ${it.available ? '' : 'unavailable'} ${over === i && drag !== null && drag !== i ? 'over' : ''}`}
                  draggable
                  onDragStart={() => setDrag(i)}
                  onDragOver={(e) => { e.preventDefault(); setOver(i) }}
                  onDragEnd={() => { setDrag(null); setOver(null) }}
                  onDrop={() => { drop(i); setDrag(null); setOver(null) }}
                >
                  <span className="grip" aria-hidden>⋮⋮</span>
                  <button
                    className="row" disabled={!it.available}
                    onClick={() => playQueue(playable, items.slice(0, i).filter((x) => x.media).length)}
                  >
                    <span className="ico">{it.available ? i + 1 : '⚠'}</span>
                    <span className="name">
                      {it.title}{it.artist && <small> · {it.artist}</small>}
                      {!it.available && <small> · no disponible</small>}
                    </span>
                    <span className="meta">{m?.duration_ms ? fmtTime(m.duration_ms / 1000) : ''}</span>
                  </button>
                  {m && (
                    <button className={`icon fav ${favs.has(m.id) ? 'on' : ''}`} aria-label="Favorito" aria-pressed={favs.has(m.id)}
                      onClick={() => {
                        const on = !favs.has(m.id)
                        usePlayer.getState().toggleFavoriteLocal(m.id, on)
                        api.setFavorite(m.id, on).catch(() => usePlayer.getState().toggleFavoriteLocal(m.id, !on))
                      }}>{favs.has(m.id) ? '♥' : '♡'}</button>
                  )}
                  <button className="icon" onClick={() => remove(it.item_id)} aria-label="Quitar de la playlist">✕</button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </PageState>
  )
}
