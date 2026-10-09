import { Link, useParams } from 'react-router-dom'
import { browseLink, fetchFolder } from '../api'
import { usePlayer } from '../store/player'
import { useFetch } from '../hooks'
import TrackList from '../components/TrackList'
import { PageState, PlayAllButtons } from '../components/Section'

export default function Browse() {
  const path = useParams()['*'] ?? ''
  const playQueue = usePlayer((s) => s.playQueue)
  const { data, error, loading } = useFetch(() => fetchFolder(path), [path])

  return (
    <PageState loading={loading && !data} error={error}>
      {data && !data.folder && <p className="msg">La biblioteca está vacía. Añade ficheros a la carpeta de medios; se detectarán automáticamente.</p>}
      {data?.folder && (
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
            <PlayAllButtons onPlay={() => playQueue(data.media, 0)} onShuffle={() => playQueue(data.media, 0, { shuffle: true })} />
          )}
          {data.folders.length === 0 && data.media.length === 0 && <p className="msg">Carpeta vacía.</p>}
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
          </ul>
          <TrackList items={data.media} numbering="none" showSize />
        </div>
      )}
    </PageState>
  )
}
