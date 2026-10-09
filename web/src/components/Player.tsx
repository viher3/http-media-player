import { useEffect, useRef, useState } from 'react'
import { coverUrl, fmtTime, getResume, putResume, recordPlay, streamUrl, subtitles, subtitleUrl, titleOf, type MediaItem, type Subtitle } from '../api'
import { save, usePlayer } from '../store/player'
import Cover from './Cover'
import { setMediaElements } from './engine'

/** Audios largos o vídeos: se guarda/reanuda la posición en el servidor. */
const resumable = (m: MediaItem) => m.kind === 'video' || (m.duration_ms ?? 0) > 20 * 60_000

/**
 * Dos elementos <video> (activo + en espera) fuera del router: navegar jamás los desmonta.
 * El de espera precarga la siguiente pista de audio para una transición casi sin silencio.
 * Se muestran/ocultan solo con CSS.
 */
export default function Player({ hidden = false }: { hidden?: boolean }) {
  const s = usePlayer()
  const refs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)]
  const [activeIdx, setActiveIdx] = useState(0)
  const active = useRef(0)
  const preloaded = useRef<{ id: number; slot: number } | null>(null)
  const lastSave = useRef(0)
  const lastResumePut = useRef(0)
  const recordedToken = useRef(-1)
  const [subs, setSubs] = useState<{ id: number; list: Subtitle[] }>({ id: -1, list: [] })

  const item = s.index >= 0 ? s.queue[s.index] : null
  const el = () => refs[active.current].current!

  useEffect(() => { setMediaElements([refs[0].current!, refs[1].current!]) }, [])

  const applyVolume = (v: HTMLVideoElement) => {
    const { volume, muted } = usePlayer.getState()
    v.volume = volume
    v.muted = muted
  }

  // --- carga / cambio de pista
  useEffect(() => {
    const st = usePlayer.getState()
    const it = st.index >= 0 ? st.queue[st.index] : null
    const cur = el()
    if (!it) { cur.removeAttribute('src'); cur.load(); return }

    const standby = 1 - active.current
    if (it.kind === 'audio' && preloaded.current?.id === it.id && preloaded.current.slot === standby) {
      // Transición: el elemento en espera ya tiene la pista cargada
      const next = refs[standby].current!
      cur.pause()
      active.current = standby
      setActiveIdx(standby)
      preloaded.current = null
      applyVolume(next)
      next.currentTime = 0
      usePlayer.setState({ duration: isFinite(next.duration) ? next.duration : 0, currentTime: 0 })
      if (st.autoplay) void next.play().catch(() => usePlayer.setState({ playing: false }))
      return
    }

    cur.src = streamUrl(it.id)
    applyVolume(cur)
    if (cur.canPlayType(it.mime) === '') usePlayer.setState({ error: 'Tu navegador no puede reproducir este formato' })
    if (st.autoplay) void cur.play().catch(() => usePlayer.setState({ playing: false }))
  }, [s.playToken])

  // --- precarga de la siguiente pista de audio en el elemento en espera
  useEffect(() => {
    const standby = refs[1 - active.current].current!
    const { queue, index, repeat } = usePlayer.getState()
    const cur = queue[index]
    const nextIdx = index + 1 < queue.length ? index + 1 : repeat === 'all' && queue.length > 1 ? 0 : -1
    const nxt = nextIdx >= 0 ? queue[nextIdx] : null
    const want = cur && cur.kind === 'audio' && nxt && nxt.kind === 'audio' && repeat !== 'one' && !resumable(nxt) ? nxt : null
    if (!want) {
      if (preloaded.current) { standby.removeAttribute('src'); standby.load(); preloaded.current = null }
      return
    }
    if (preloaded.current?.id === want.id && preloaded.current.slot === 1 - active.current) return
    standby.preload = 'auto'
    standby.src = streamUrl(want.id)
    preloaded.current = { id: want.id, slot: 1 - active.current }
  }, [s.playToken, s.queue, s.repeat, activeIdx])

  // --- play/pausa
  useEffect(() => {
    if (!item) return
    const v = el()
    if (s.playing && v.paused) void v.play().catch(() => usePlayer.setState({ playing: false }))
    if (!s.playing && !v.paused) v.pause()
  }, [s.playing, s.playToken])

  useEffect(() => { refs.forEach((r) => r.current && applyVolume(r.current)) }, [s.volume, s.muted])

  useEffect(() => {
    if (s.seekTo !== null) {
      el().currentTime = s.seekTo
      usePlayer.setState({ seekTo: null })
    }
  }, [s.seekTo])

  // --- subtítulos del vídeo actual
  useEffect(() => {
    if (!item || item.kind !== 'video') { setSubs({ id: -1, list: [] }); return }
    let cancelled = false
    subtitles(item.id).then((list) => !cancelled && setSubs({ id: item.id, list })).catch(() => {})
    return () => { cancelled = true }
  }, [item?.id, item?.kind])

  // --- persistencia local
  const persist = (time: number) => {
    const { queue, index, volume, muted, shuffle, repeat, unshuffled } = usePlayer.getState()
    save({ queue, index, time, volume, muted, shuffle, repeat, unshuffled })
  }
  useEffect(() => { persist(el().currentTime || 0) }, [s.queue, s.index, s.volume, s.muted, s.shuffle, s.repeat])

  // --- Media Session
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!item) { navigator.mediaSession.metadata = null; return }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titleOf(item), artist: item.artist ?? '', album: item.album ?? '',
      artwork: item.has_cover ? [{ src: coverUrl(item.id, 512), sizes: '512x512', type: 'image/jpeg' }] : [],
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
    set('seekbackward', (d) => st().seek(Math.max(0, el().currentTime - (d.seekOffset ?? 10))))
    set('seekforward', (d) => st().seek(el().currentTime + (d.seekOffset ?? 10)))
  }, [])

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = item ? (s.playing ? 'playing' : 'paused') : 'none'
  }, [s.playing, item?.id])

  const isVideo = item?.kind === 'video'
  const mode = hidden || !isVideo ? 'hidden' : s.expanded ? 'expanded' : 'mini'

  // Eventos: solo cuentan los del elemento activo
  const mine = (e: { currentTarget: HTMLVideoElement }) => e.currentTarget === refs[active.current].current

  const syncResume = (v: HTMLVideoElement, force = false) => {
    const it = usePlayer.getState().queue[usePlayer.getState().index]
    if (!it || !resumable(it) || !isFinite(v.duration)) return
    if (!force && Date.now() - lastResumePut.current < 10_000) return
    lastResumePut.current = Date.now()
    void putResume(it.id, Math.round(v.currentTime * 1000), Math.round(v.duration * 1000)).catch(() => {})
  }

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
        {[0, 1].map((i) => (
          <video
            key={i}
            ref={refs[i]}
            className={i === activeIdx ? '' : 'standby'}
            playsInline
            preload="metadata"
            onClick={() => s.toggle()}
            onPlay={(e) => { if (mine(e)) usePlayer.setState({ playing: true }) }}
            onPause={(e) => {
              if (!mine(e)) return
              if (!e.currentTarget.ended) { usePlayer.setState({ playing: false }); syncResume(e.currentTarget, true) }
            }}
            onLoadedMetadata={async (e) => {
              const v = e.currentTarget
              if (!mine(e)) return
              usePlayer.setState({ duration: v.duration })
              const { resumeAt, queue, index } = usePlayer.getState()
              const it = queue[index]
              if (resumeAt > 0 && resumeAt < v.duration) v.currentTime = resumeAt
              else if (it && resumable(it) && usePlayer.getState().autoplay) {
                try {
                  const r = await getResume(it.id)
                  if (r.position_ms > 0 && v.currentTime < 2 && queue[usePlayer.getState().index]?.id === it.id) v.currentTime = r.position_ms / 1000
                } catch { /* sin reanudación */ }
              }
              usePlayer.setState({ resumeAt: 0 })
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget
              if (!mine(e)) return
              usePlayer.setState({ currentTime: v.currentTime })
              const st = usePlayer.getState()
              if (Date.now() - lastSave.current > 2000) { lastSave.current = Date.now(); persist(v.currentTime) }
              // Historial: tras 30 s (o la mitad si es más corta)
              if (recordedToken.current !== st.playToken && st.playing && v.currentTime >= Math.min(30, (v.duration || 60) / 2)) {
                recordedToken.current = st.playToken
                const it = st.queue[st.index]
                if (it) void recordPlay(it.id).catch(() => {})
              }
              syncResume(v)
              if ('mediaSession' in navigator && isFinite(v.duration) && v.duration > 0) {
                try {
                  navigator.mediaSession.setPositionState({ duration: v.duration, position: Math.min(v.currentTime, v.duration), playbackRate: v.playbackRate })
                } catch { /* ignore */ }
              }
            }}
            onEnded={(e) => {
              if (!mine(e)) return
              const v = e.currentTarget
              const st = usePlayer.getState()
              const it = st.queue[st.index]
              if (it && resumable(it)) void putResume(it.id, Math.round(v.duration * 1000), Math.round(v.duration * 1000)).catch(() => {})
              if (st.repeat === 'one') { v.currentTime = 0; void v.play() }
              else st.next()
            }}
            onError={(e) => { if (mine(e) && e.currentTarget.getAttribute('src')) usePlayer.setState({ playing: false, error: 'No se pudo reproducir este archivo' }) }}
          >
            {i === activeIdx && isVideo && subs.id === item?.id && subs.list.map((t, k) => (
              <track key={t.name} kind="subtitles" src={subtitleUrl(item!.id, t.name)} srcLang={t.lang || undefined} label={t.label} default={k === 0} />
            ))}
          </video>
        ))}
      </div>

      <footer className="player" hidden={hidden}>
        <button className="np" onClick={() => (isVideo ? s.setExpanded(!s.expanded) : item && s.setNowPlaying(!s.nowPlayingOpen))} aria-label="Abrir reproductor">
          <Cover src={item?.has_cover ? coverUrl(item.id, 128) : null} fallback={item ? (isVideo ? '🎬' : '♪') : ''} />
          <div className="np-text">
            <div className="np-title">{item ? titleOf(item) : 'Nada en reproducción'}</div>
            <div className="np-sub">{s.error ? <span className="err">{s.error}</span> : item?.artist ?? (isVideo ? 'Vídeo' : '')}</div>
          </div>
        </button>

        <div className="center">
          <div className="buttons">
            <button className={s.shuffle ? 'on' : ''} onClick={s.toggleShuffle} aria-pressed={s.shuffle} aria-label="Aleatorio" title="Aleatorio (s)">🔀</button>
            <button onClick={s.prev} disabled={!item} aria-label="Anterior" title="Anterior (p)">⏮</button>
            <button className="play" onClick={s.toggle} disabled={!item} aria-label={s.playing ? 'Pausa' : 'Reproducir'} title="Reproducir / pausa (espacio)">
              {s.playing ? '⏸' : '▶'}
            </button>
            <button onClick={s.next} disabled={!item || (s.index >= s.queue.length - 1 && s.repeat !== 'all')} aria-label="Siguiente" title="Siguiente (n)">⏭</button>
            <button className={s.repeat !== 'off' ? 'on' : ''} onClick={s.cycleRepeat} aria-label={`Repetir: ${s.repeat}`} title="Repetir (r)">
              {s.repeat === 'one' ? '🔂' : '🔁'}
            </button>
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
          <button className={s.nowPlayingOpen ? 'on' : ''} onClick={() => s.setNowPlaying(!s.nowPlayingOpen)} aria-label="Cola de reproducción" title="Cola">☰</button>
          {isVideo && (
            <>
              <button onClick={() => s.setExpanded(!s.expanded)} aria-label="Ver vídeo">🖵</button>
              <button onClick={() => el().requestFullscreen?.()} aria-label="Pantalla completa">⛶</button>
            </>
          )}
          <button onClick={s.toggleMute} aria-label="Silenciar" title="Silenciar (m)">{s.muted || s.volume === 0 ? '🔇' : '🔊'}</button>
          <input
            type="range" min={0} max={1} step={0.01} value={s.muted ? 0 : s.volume}
            onChange={(e) => s.setVolume(Number(e.target.value))} aria-label="Volumen"
          />
        </div>
      </footer>
    </>
  )
}
