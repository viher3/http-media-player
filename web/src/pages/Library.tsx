import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import * as api from '../api'
import { albumCoverUrl } from '../api'
import { useFetch } from '../hooks'
import { usePlayer } from '../store/player'
import AlbumGrid from '../components/AlbumGrid'
import Cover from '../components/Cover'
import TrackList from '../components/TrackList'
import { PageState, PlayAllButtons } from '../components/Section'

const playAll = (items: api.MediaItem[]) => ({
  onPlay: () => usePlayer.getState().playQueue(items, 0),
  onShuffle: () => usePlayer.getState().playQueue(items, 0, { shuffle: true }),
})

export function Home() {
  const added = useFetch(() => api.albums('recent'), [])
  const recent = useFetch(api.recentlyPlayed, [])
  const top = useFetch(api.mostPlayed, [])
  return (
    <div>
      <h2>Inicio</h2>
      <PageState loading={added.loading && !added.data} error={added.error}>
        {added.data && added.data.length > 0 && (
          <section><h3>Añadido recientemente</h3><AlbumGrid albums={added.data.slice(0, 12)} /></section>
        )}
        {added.data?.length === 0 && <p className="msg">Todavía no hay música categorizada. <Link to="/browse">Explora las carpetas</Link>.</p>}
      </PageState>
      {recent.data && recent.data.length > 0 && <section><h3>Reproducido recientemente</h3><TrackList items={recent.data.slice(0, 10)} numbering="none" /></section>}
      {top.data && top.data.length > 0 && <section><h3>Más escuchadas</h3><TrackList items={top.data.slice(0, 10)} numbering="index" /></section>}
    </div>
  )
}

export function Artists() {
  const { data, error, loading } = useFetch(api.artists, [])
  return (
    <div>
      <h2>Artistas</h2>
      <PageState loading={loading && !data} error={error}>
        {data?.length === 0 && <p className="msg">Sin artistas.</p>}
        <div className="grid">
          {data?.map((a) => (
            <Link key={a.id} to={`/artists/${a.id}`} className="card">
              <Cover round src={a.cover_album_id ? albumCoverUrl(a.cover_album_id, 256) : null} fallback={a.name.slice(0, 1).toUpperCase()} />
              <div className="card-title">{a.name}</div>
              <div className="card-sub">{a.album_count} álbumes · {a.track_count} pistas</div>
            </Link>
          ))}
        </div>
      </PageState>
    </div>
  )
}

export function ArtistPage() {
  const id = Number(useParams().id)
  const { data, error, loading } = useFetch(() => api.artist(id), [id])
  return (
    <PageState loading={loading && !data} error={error}>
      {data && (
        <div>
          <h2>{data.artist.name}</h2>
          {data.albums.length > 0 && <AlbumGrid albums={data.albums} />}
          {data.singles.length > 0 && (
            <section>
              <h3>Sueltas</h3>
              <PlayAllButtons {...playAll(data.singles)} />
              <TrackList items={data.singles} numbering="none" />
            </section>
          )}
        </div>
      )}
    </PageState>
  )
}

export function Albums() {
  const [sort, setSort] = useState<'title' | 'year' | 'recent'>('title')
  const { data, error, loading } = useFetch(() => api.albums(sort === 'title' ? undefined : sort), [sort])
  return (
    <div>
      <div className="head-row">
        <h2>Álbumes</h2>
        <label className="sort">Ordenar{' '}
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="title">Título</option><option value="year">Año</option><option value="recent">Recientes</option>
          </select>
        </label>
      </div>
      <PageState loading={loading && !data} error={error}>
        {data?.length === 0 && <p className="msg">Sin álbumes.</p>}
        {data && <AlbumGrid albums={data} />}
      </PageState>
    </div>
  )
}

export function AlbumPage() {
  const id = Number(useParams().id)
  const { data, error, loading } = useFetch(() => api.album(id), [id])
  return (
    <PageState loading={loading && !data} error={error}>
      {data && (
        <div>
          <div className="album-head">
            <Cover src={data.album.has_cover ? albumCoverUrl(id, 512) : null} fallback="💿" className="hero" />
            <div>
              <h2>{data.album.title}</h2>
              <p className="muted">
                {data.album.artist_id ? <Link to={`/artists/${data.album.artist_id}`}>{data.album.artist_name}</Link> : data.album.artist_name}
                {data.album.year ? ` · ${data.album.year}` : ''} · {data.tracks.length} pistas
              </p>
              <PlayAllButtons {...playAll(data.tracks)} />
            </div>
          </div>
          <TrackList items={data.tracks} numbering="track" />
        </div>
      )}
    </PageState>
  )
}

export function Genres() {
  const { data, error, loading } = useFetch(api.genres, [])
  return (
    <div>
      <h2>Géneros</h2>
      <PageState loading={loading && !data} error={error}>
        {data?.length === 0 && <p className="msg">Ninguna pista tiene género en sus etiquetas.</p>}
        <ul className="list">
          {data?.map((g) => (
            <li key={g.name}>
              <Link className="row" to={`/genres/${encodeURIComponent(g.name)}`}>
                <span className="ico">🏷</span><span className="name">{g.name}</span><span className="meta">{g.track_count} pistas</span>
              </Link>
            </li>
          ))}
        </ul>
      </PageState>
    </div>
  )
}

export function GenrePage() {
  const name = useParams().name ?? ''
  const { data, error, loading } = useFetch(() => api.genre(name), [name])
  return (
    <PageState loading={loading && !data} error={error}>
      {data && (
        <div>
          <h2>{data.name}</h2>
          <PlayAllButtons {...playAll(data.tracks)} />
          <TrackList items={data.tracks} numbering="none" showAlbum />
        </div>
      )}
    </PageState>
  )
}

export function Videos() {
  const { data, error, loading } = useFetch(api.videos, [])
  const playQueue = usePlayer((s) => s.playQueue)
  // Agrupados por carpeta
  const groups = new Map<string, api.MediaItem[]>()
  data?.forEach((v) => groups.set(v.folder_path, [...(groups.get(v.folder_path) ?? []), v]))
  return (
    <div>
      <h2>Vídeos</h2>
      <PageState loading={loading && !data} error={error}>
        {data?.length === 0 && <p className="msg">No hay vídeos en la biblioteca.</p>}
        {[...groups].map(([folder, items]) => (
          <section key={folder}>
            <h3><Link to={api.browseLink(folder)}>{folder || 'Biblioteca'}</Link></h3>
            <TrackList items={items} numbering="none" showSize onPlay={(i) => playQueue(items, i)} />
          </section>
        ))}
      </PageState>
    </div>
  )
}

export function Favorites() {
  const { data, error, loading } = useFetch(api.favorites, [])
  const favs = usePlayer((s) => s.favorites)
  // Se mantiene la lista cargada; al desmarcar un favorito desaparece al recargar la vista
  const items = data?.filter((m) => favs.has(m.id)) ?? []
  return (
    <div>
      <h2>Favoritos</h2>
      <PageState loading={loading && !data} error={error}>
        {items.length === 0 && <p className="msg">Marca pistas con ♡ para verlas aquí.</p>}
        {items.length > 0 && <PlayAllButtons {...playAll(items)} />}
        <TrackList items={items} numbering="none" showAlbum />
      </PageState>
    </div>
  )
}

export function SearchPage() {
  const [params] = useSearchParams()
  const q = params.get('q') ?? ''
  const { data, error, loading } = useFetch(() => (q.trim() ? api.search(q) : Promise.resolve(null)), [q])
  return (
    <div>
      <h2>Búsqueda{q ? `: «${q}»` : ''}</h2>
      <PageState loading={loading && !data} error={error}>
        {!q.trim() && <p className="msg">Escribe en el buscador (atajo: <kbd>/</kbd>).</p>}
        {data && !data.media.length && !data.albums.length && !data.artists.length && <p className="msg">Sin resultados.</p>}
        {data && data.artists.length > 0 && (
          <section><h3>Artistas</h3>
            <ul className="list">{data.artists.map((a) => (
              <li key={a.id}><Link className="row" to={`/artists/${a.id}`}><span className="ico">🎤</span><span className="name">{a.name}</span></Link></li>
            ))}</ul>
          </section>
        )}
        {data && data.albums.length > 0 && <section><h3>Álbumes</h3><AlbumGrid albums={data.albums} /></section>}
        {data && data.media.length > 0 && <section><h3>Pistas</h3><TrackList items={data.media} numbering="none" showAlbum /></section>}
      </PageState>
    </div>
  )
}
