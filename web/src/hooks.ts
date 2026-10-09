import { useEffect, useState } from 'react'
import { useApp } from './store/app'

/** Carga de datos con refresco automático cuando cambia la biblioteca (reescaneo / watcher). */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]) {
  const version = useApp((s) => s.libraryVersion)
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fn().then(
      (data) => !cancelled && setState({ data, error: null, loading: false }),
      (e: Error) => !cancelled && setState({ data: null, error: e.message, loading: false }),
    )
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, nonce])

  return { ...state, reload: () => setNonce((n) => n + 1) }
}
