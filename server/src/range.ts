export type RangeResult = { start: number; end: number } | 'unsatisfiable' | null

/** Parsea una cabecera Range de un único rango. null = sin rango válido (servir completo). */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, s, e] = m
  if (s === '' && e === '') return null
  let start: number, end: number
  if (s === '') {
    const n = Number(e)
    if (n === 0) return 'unsatisfiable'
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(s)
    end = e === '' ? size - 1 : Math.min(Number(e), size - 1)
  }
  if (start >= size || start > end) return 'unsatisfiable'
  return { start, end }
}
