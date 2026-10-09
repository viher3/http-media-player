import { useEffect, useState } from 'react'

/** Imagen con carga diferida y marcador de posición si no existe / falla. */
export default function Cover({ src, fallback = '♪', className = '', round = false }: {
  src: string | null; fallback?: string; className?: string; round?: boolean
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return <div className={`cover ph ${round ? 'round' : ''} ${className}`} aria-hidden>{fallback}</div>
  return <img className={`cover ${round ? 'round' : ''} ${className}`} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
}
