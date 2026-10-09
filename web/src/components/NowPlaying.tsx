import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { coverUrl, fmtTime, lyrics as fetchLyrics, titleOf, type Lyrics } from '../api'
import { usePlayer } from '../store/player'
import { enableVisualizer, getAnalyser } from '../visualizer'
import { getMediaElements } from './engine'
import Cover from './Cover'

function Visualizer() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [on, setOn] = useState(!!getAnalyser())

  useEffect(() => {
    if (!on) return
    const an = enableVisualizer(getMediaElements())
    const c = canvas.current
    if (!an || !c) return
    const g = c.getContext('2d')!
    const data = new Uint8Array(an.frequencyBinCount)
    let raf = 0
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1ed760'
    const draw = () => {
      an.getByteFrequencyData(data)
      g.clearRect(0, 0, c.width, c.height)
      g.fillStyle = accent
      const bars = 32, w = c.width / bars
      for (let i = 0; i < bars; i++) {
        const v = data[Math.floor((i / bars) * data.length * 0.7)] / 255
        const h = Math.max(2, v * c.height)
        g.fillRect(i * w + 1, c.height - h, w - 2, h)
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [on])

  return on
    ? <canvas ref={canvas} className="viz" width={320} height={60} aria-label="Visualizador de audio" />
    : <button className="viz-btn" onClick={() => setOn(true)}>▁▃▅▇ Activar visualizador</button>
}

function LyricsView({ id }: { id: number }) {
  const [ly, setLy] = useState<Lyrics | null>(null)
  const time = usePlayer((s) => s.currentTime)
  const seek = usePlayer((s) => s.seek)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLy(null)
    fetchLyrics(id).then((l) => !cancelled && setLy(l)).catch(() => !cancelled && setLy({ synced: null, text: null }))
    return () => { cancelled = true }
  }, [id])

  const activeLine = ly?.synced ? ly.synced.reduce((acc, l, i) => (l.t <= time + 0.2 ? i : acc), -1) : -1
  useEffect(() => {
    const node = box.current?.querySelector('.cur') as HTMLElement | null
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeLine])

  if (!ly) return <p className="msg">Cargando letra…</p>
  if (ly.synced) {
    return (
      <div className="lyrics" ref={box}>
        {ly.synced.map((l, i) => (
          <button key={i} className={`line ${i === activeLine ? 'cur' : ''}`} onClick={() => seek(l.t)}>{l.text || '♪'}</button>
        ))}
      </div>
    )
  }
  if (ly.text) return <div className="lyrics plain">{ly.text}</div>
  return <p className="msg">Sin letra disponible. Añade un fichero .lrc junto a la pista o incrusta la letra en las etiquetas.</p>
}

function QueuePanel() {
  const { queue, index, jumpTo, removeAt, moveInQueue, clearQueue } = usePlayer()
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const curRef = useRef<HTMLLIElement>(null)
  useEffect(() => { curRef.current?.scrollIntoView({ block: 'nearest' }) }, [index])

  return (
    <div>
      <div className="queue-head">
        <b>{queue.length} en cola</b>
        {queue.length > 1 && <button onClick={clearQueue}>Vaciar cola</button>}
      </div>
      <ol className="queue">
        {queue.map((m, i) => (
          <li
            key={`${i}-${m.id}`}
            ref={i === index ? curRef : undefined}
            className={`${i === index ? 'active' : ''} ${over === i && drag !== null && drag !== i ? 'over' : ''}`}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => { e.preventDefault(); setOver(i) }}
            onDragEnd={() => { setDrag(null); setOver(null) }}
            onDrop={() => { if (drag !== null) moveInQueue(drag, i); setDrag(null); setOver(null) }}
          >
            <span className="grip" aria-hidden>⋮⋮</span>
            <button className="q-main" onClick={() => jumpTo(i)}>
              <span className="name">{titleOf(m)}{m.artist && <small> · {m.artist}</small>}</span>
              <span className="meta">{m.duration_ms ? fmtTime(m.duration_ms / 1000) : ''}</span>
            </button>
            <span className="q-actions">
              <button disabled={i === 0} onClick={() => moveInQueue(i, i - 1)} aria-label="Subir">↑</button>
              <button disabled={i === queue.length - 1} onClick={() => moveInQueue(i, i + 1)} aria-label="Bajar">↓</button>
              <button disabled={i === index} onClick={() => removeAt(i)} aria-label="Quitar de la cola">✕</button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Vista "Reproduciendo": carátula grande, letra, visualizador y cola. */
export default function NowPlaying() {
  const open = usePlayer((s) => s.nowPlayingOpen)
  const close = usePlayer((s) => s.setNowPlaying)
  const item = usePlayer((s) => (s.index >= 0 ? s.queue[s.index] : null))
  const [tab, setTab] = useState<'now' | 'queue'>('now')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <section className="nowplaying" role="dialog" aria-label="Reproduciendo">
      <div className="np-top">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'now'} className={tab === 'now' ? 'sel' : ''} onClick={() => setTab('now')}>Reproduciendo</button>
          <button role="tab" aria-selected={tab === 'queue'} className={tab === 'queue' ? 'sel' : ''} onClick={() => setTab('queue')}>Cola</button>
        </div>
        <button onClick={() => close(false)} aria-label="Cerrar">✕</button>
      </div>
      <div className="np-body">
        {tab === 'queue' ? <QueuePanel /> : !item ? <p className="msg">Nada en reproducción</p> : (
          <div className="np-grid">
            <div className="np-art">
              <Cover src={item.has_cover ? coverUrl(item.id, 512) : null} className="big" fallback={item.kind === 'video' ? '🎬' : '♪'} />
              <h2>{titleOf(item)}</h2>
              <p className="muted">
                {item.artist_id ? <Link to={`/artists/${item.artist_id}`} onClick={() => close(false)}>{item.artist ?? ''}</Link> : item.artist}
                {item.album && item.album_id && <> · <Link to={`/albums/${item.album_id}`} onClick={() => close(false)}>{item.album}</Link></>}
              </p>
              <Visualizer />
            </div>
            <LyricsView id={item.id} />
          </div>
        )}
      </div>
    </section>
  )
}
