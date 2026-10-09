import { useEffect, useRef } from 'react'
import { coverUrl, fmtTime, streamUrl, titleOf } from '../api'
import { save, usePlayer } from '../store/player'

/**
 * Único elemento <video> de toda la app (sirve audio y vídeo). Vive fuera del router,
 * por lo que navegar jamás lo desmonta. Se muestra/oculta/redimensiona solo con CSS.
 */
export default function Player() {
  const s = usePlayer()
  const ref = useRef<HTMLVideoElement>(null)
  const item = s.index >= 0 ? s.queue[s.index] : null
  const lastSave = useRef(0)

  // Carga de pista
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!item) { el.removeAttribute('src'); el.load(); return }
    el.src = streamUrl(item.id)
    const st = usePlayer.getState()
    if (el.canPlayType(item.mime) === '') usePlayer.setState({ error: 'Tu navegador no puede reproducir este formato' })
    if (st.autoplay) void el.play().catch(() => usePlayer.setState({ playing: false }))
  }, [item?.id])

  // play/pausa
  useEffect(() => {
    const el = ref.current
    if (!el || !item) return
    if (s.playing && el.paused) void el.play().catch(() => usePlayer.setState({ playing: false }))
    if (!s.playing && !el.paused) el.pause()
  }, [s.playing, item?.id])

  useEffect(() => { if (ref.current) { ref.current.volume = s.volume; ref.current.muted = s.muted } }, [s.volume, s.muted])

  useEffect(() => {
    if (s.seekTo !== null && ref.current) {
      ref.current.currentTime = s.seekTo
      usePlayer.setState({ seekTo: null })
    }
  }, [s.seekTo])

  // Persistencia
  useEffect(() => {
    const { queue, index, volume, muted } = usePlayer.getState()
    save({ queue, index, time: ref.current?.currentTime ?? 0, volume, muted })
  }, [s.queue, s.index, s.volume, s.muted])

  // Media Session
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!item) { navigator.mediaSession.metadata = null; return }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titleOf(item), artist: item.artist ?? '', album: item.album ?? '',
      artwork: item.has_cover ? [{ src: coverUrl(item.id) }] : [],
    })
  }, [item?.id])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const st = () => usePlayer.getState()
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, h) } catch { /* no soportado */ } }
    set('play', () => st().setPlaying(true))
    set('pause', () => st().setPlaying(false))
    set('previoustrack', () => st().prev())
    set('nexttrack', () => st().next())
    set('seekto', (d) => { if (d.seekTime !== undefined) st().seek(d.seekTime) })
    set('seekbackward', (d) => st().seek(Math.max(0, (ref.current?.currentTime ?? 0) - (d.seekOffset ?? 10))))
    set('seekforward', (d) => st().seek((ref.current?.currentTime ?? 0) + (d.seekOffset ?? 10)))
  }, [])

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = item ? (s.playing ? 'playing' : 'paused') : 'none'
  }, [s.playing, item?.id])

  const isVideo = item?.kind === 'video'
  const mode = !isVideo ? 'hidden' : s.expanded ? 'expanded' : 'mini'

  return (
    <>
      <div className={`video-box ${mode}`}>
        {isVideo && (
          <div className="video-actions">
            <button onClick={() => s.setExpanded(!s.expanded)} aria-label={s.expanded ? 'Minimizar' : 'Ampliar'}>
              {s.expanded ? '▾' : '▴'}
            </button>
          </div>
        )}
        <video
          ref={ref}
          playsInline
          preload="metadata"
          onClick={() => s.toggle()}
          onPlay={() => usePlayer.setState({ playing: true })}
          onPause={() => { if (!ref.current?.ended) usePlayer.setState({ playing: false }) }}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget
            usePlayer.setState({ duration: el.duration })
            const { resumeAt } = usePlayer.getState()
            if (resumeAt > 0 && resumeAt < el.duration) { el.currentTime = resumeAt }
            usePlayer.setState({ resumeAt: 0 })
          }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget
            usePlayer.setState({ currentTime: el.currentTime })
            if (Date.now() - lastSave.current > 2000) {
              lastSave.current = Date.now()
              const { queue, index, volume, muted } = usePlayer.getState()
              save({ queue, index, time: el.currentTime, volume, muted })
            }
            if ('mediaSession' in navigator && isFinite(el.duration) && el.duration > 0) {
              try {
                navigator.mediaSession.setPositionState({ duration: el.duration, position: Math.min(el.currentTime, el.duration), playbackRate: el.playbackRate })
              } catch { /* ignore */ }
            }
          }}
          onEnded={() => usePlayer.getState().next()}
          onError={() => usePlayer.setState({ playing: false, error: 'No se pudo reproducir este archivo' })}
        />
      </div>

      <footer className="player">
        <div className="np">
          {item?.has_cover ? (
            <img className="cover" src={coverUrl(item.id)} alt="" />
          ) : (
            <div className="cover ph">{item ? (isVideo ? '🎬' : '♪') : ''}</div>
          )}
          <div className="np-text">
            <div className="np-title">{item ? titleOf(item) : 'Nada en reproducción'}</div>
            <div className="np-sub">{s.error ? <span className="err">{s.error}</span> : item?.artist ?? (item?.kind === 'video' ? 'Vídeo' : '')}</div>
          </div>
        </div>

        <div className="center">
          <div className="buttons">
            <button onClick={s.prev} disabled={!item} aria-label="Anterior">⏮</button>
            <button className="play" onClick={s.toggle} disabled={!item} aria-label={s.playing ? 'Pausa' : 'Reproducir'}>
              {s.playing ? '⏸' : '▶'}
            </button>
            <button onClick={s.next} disabled={!item || s.index >= s.queue.length - 1} aria-label="Siguiente">⏭</button>
          </div>
          <div className="progress">
            <span>{fmtTime(s.currentTime)}</span>
            <input
              type="range" min={0} max={s.duration || 0} step={0.1}
              value={Math.min(s.currentTime, s.duration || 0)}
              disabled={!item || !s.duration}
              onChange={(e) => s.seek(Number(e.target.value))}
              aria-label="Progreso"
            />
            <span>{fmtTime(s.duration)}</span>
          </div>
        </div>

        <div className="right">
          {isVideo && (
            <>
              <button onClick={() => s.setExpanded(!s.expanded)} aria-label="Ver vídeo">🖵</button>
              <button onClick={() => ref.current?.requestFullscreen?.()} aria-label="Pantalla completa">⛶</button>
            </>
          )}
          <button onClick={s.toggleMute} aria-label="Silenciar">{s.muted || s.volume === 0 ? '🔇' : '🔊'}</button>
          <input
            type="range" min={0} max={1} step={0.01} value={s.muted ? 0 : s.volume}
            onChange={(e) => s.setVolume(Number(e.target.value))} aria-label="Volumen"
          />
        </div>
      </footer>
    </>
  )
}
