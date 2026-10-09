import path from 'node:path'
import fs from 'node:fs'

/** Normaliza una ruta relativa de la biblioteca ("a/b"). Devuelve null si es insegura. */
export function normalizeRel(p: string): string | null {
  if (p.includes('\0')) return null
  const parts = p.split(/[\\/]+/).filter((s) => s !== '' && s !== '.')
  if (parts.includes('..')) return null
  return parts.join('/')
}

/** Resuelve una ruta relativa a absoluta garantizando (vía realpath) que queda dentro de root. */
export function resolveInside(root: string, rel: string): string | null {
  const n = normalizeRel(rel)
  if (n === null) return null
  try {
    const real = fs.realpathSync(path.join(root, n))
    if (real !== root && !real.startsWith(root + path.sep)) return null
    return real
  } catch {
    return null
  }
}
