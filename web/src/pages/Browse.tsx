import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchFolder, fmtSize, fmtTime, titleOf, type FolderPayload } from '../api'
import { usePlayer } from '../store/player'

export const browseLink = (p: string) => '/browse' + (p ? '/' + p.split('/').map(encodeURIComponent).join('/') : '')

export default function Browse() {
  const path = useParams()['*'] ?? ''
  const version = usePlayer((s) => s.libraryVersion)
  const current = usePlayer((s) => (s.index >= 0 ? s.queue[s.index] : null))
  const playing = usePlayer((s) => s.playing)
  const playQueue = usePlayer((s) => s.playQueue)
  const [data, setData] = useState<FolderPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchFolder(path).then((d) => !cancelled && setData(d)).catch((e: Error) => !cancelled && (setData(null), setError(e.message)))
    return () => { cancelled = true }
  }, [path, version])

  if (error) return <p className="msg">{error}. <Link to="/browse">Volver al inicio</Link></p>
  if (!data) return <p className="msg">Cargando…</p>
  if (!data.folder) return <p className="msg">La biblioteca está vacía. Pulsa «Reescanear» tras añadir ficheros a la carpeta de medios.</p>

  const empty = data.folders.length === 0 && data.media.length === 0

  return (
    <div>
      <nav className="crumbs" aria-label="Ruta">
        {data.breadcrumb.map((b, i) => (
          <span key={b.id}>
            {i > 0 && <span className="sep">/</span>}
            {i === data.breadcrumb.length - 1 ? <b>{b.name}</b> : <Link to={browseLink(b.path)}>{b.name}</Link>}
          </span>
        ))}
      </nav>

      {data.media.length > 0 && (
        <button className="primary" onClick={() => playQueue(data.media, 0)}>▶ Reproducir carpeta</button>
      )}

      {empty && <p className="msg">Carpeta vacía.</p>}

      <ul className="list">
        {data.folders.map((f) => (
          <li key={'f' + f.id}>
            <Link to={browseLink(f.path)} className="row">
              <span className="ico">📁</span>
              <span className="name">{f.name}</span>
              <span className="meta">{f.media_count > 0 ? `${f.media_count} archivos` : ''}</span>
            </Link>
          </li>
        ))}
        {data.media.map((m, i) => {
          const active = current?.id === m.id
          return (
            <li key={'m' + m.id}>
              <button className={`row ${active ? 'active' : ''}`} onClick={() => playQueue(data.media, i)}>
                <span className="ico">{active && playing ? '🔊' : m.kind === 'video' ? '🎬' : '🎵'}</span>
                <span className="name">
                  {titleOf(m)}
                  {m.artist && <small> · {m.artist}</small>}
                </span>
                <span className="meta">
                  {m.duration_ms ? fmtTime(m.duration_ms / 1000) : '–'} · {fmtSize(m.size)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
