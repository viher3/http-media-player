import { useEffect } from 'react'
import { usePlayer } from './store/player'
import { getMediaElements } from './components/engine'

/** Atajos globales: espacio, ←/→ (±5 s), ↑/↓ (volumen), n/p, m, s, r, /. */
export function useShortcuts(focusSearch: () => void) {
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      if (!el) return false
      if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
      return el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox'
    }
    const cur = () => getMediaElements().find((v) => v.currentSrc && !v.classList.contains('standby'))

    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
      const p = usePlayer.getState()
      switch (e.key) {
        case ' ': e.preventDefault(); p.toggle(); break
        case 'ArrowRight': if ((e.target as HTMLElement).tagName === 'INPUT') return; e.preventDefault(); p.seek((cur()?.currentTime ?? 0) + 5); break
        case 'ArrowLeft': if ((e.target as HTMLElement).tagName === 'INPUT') return; e.preventDefault(); p.seek(Math.max(0, (cur()?.currentTime ?? 0) - 5)); break
        case 'ArrowUp': if ((e.target as HTMLElement).tagName === 'INPUT') return; e.preventDefault(); p.setVolume(p.volume + 0.05); break
        case 'ArrowDown': if ((e.target as HTMLElement).tagName === 'INPUT') return; e.preventDefault(); p.setVolume(p.volume - 0.05); break
        case 'n': p.next(); break
        case 'p': p.prev(); break
        case 'm': p.toggleMute(); break
        case 's': p.toggleShuffle(); break
        case 'r': p.cycleRepeat(); break
        case '/': e.preventDefault(); focusSearch(); break
      }
    }
    // Evita que la barra espaciadora "pulse" el botón enfocado al soltarla
    const up = (e: KeyboardEvent) => { if (e.key === ' ' && !typing(e.target)) e.preventDefault() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])
}
