import { Link } from 'react-router-dom'
import { albumCoverUrl, type AlbumSummary } from '../api'
import Cover from './Cover'

export default function AlbumGrid({ albums }: { albums: AlbumSummary[] }) {
  return (
    <div className="grid">
      {albums.map((a) => (
        <Link key={a.id} to={`/albums/${a.id}`} className="card">
          <Cover src={a.has_cover ? albumCoverUrl(a.id, 256) : null} fallback="💿" />
          <div className="card-title">{a.title}</div>
          <div className="card-sub">{[a.artist_name, a.year].filter(Boolean).join(' · ')}</div>
        </Link>
      ))}
    </div>
  )
}
