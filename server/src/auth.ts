import crypto from 'node:crypto'
import { promisify } from 'node:util'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from './db.js'

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

export const COOKIE = 'hmp_session'
const SESSION_MS = 30 * 24 * 3600 * 1000

export type User = { id: number; username: string; is_admin: number }
declare module 'fastify' {
  interface FastifyRequest { user?: User }
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(pw, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltB64, hashB64] = stored.split('$')
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length)
  return crypto.timingSafeEqual(actual, expected)
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

function readCookie(req: FastifyRequest, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}

function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string, maxAgeSec: number) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https'
  reply.header('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`)
}

// Limitador de intentos fallidos de login en memoria: 5 fallos por (ip, usuario) => bloqueo 60 s
const fails = new Map<string, { n: number; until: number }>()
const failKey = (ip: string, user: string) => `${ip}|${user.toLowerCase()}`

export function registerAuth(app: FastifyInstance, db: Db) {
  const userCount = () => (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n

  const createSession = (req: FastifyRequest, reply: FastifyReply, userId: number) => {
    const token = crypto.randomBytes(32).toString('hex')
    db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(sha(token), userId, Date.now() + SESSION_MS)
    setSessionCookie(req, reply, token, SESSION_MS / 1000)
  }

  const validCreds = (b: any) =>
    b && typeof b.username === 'string' && typeof b.password === 'string' &&
    /^[\p{L}\p{N}._-]{1,64}$/u.test(b.username) && b.password.length >= 8 && b.password.length <= 256

  // Cargar usuario desde la cookie y exigir sesión en toda la API salvo /api/auth/*
  app.addHook('onRequest', async (req, reply) => {
    const token = readCookie(req, COOKIE)
    if (token) {
      const row = db.prepare(
        `SELECT u.id, u.username, u.is_admin, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`).get(sha(token)) as (User & { expires_at: number }) | undefined
      if (row && row.expires_at > Date.now()) req.user = { id: row.id, username: row.username, is_admin: row.is_admin }
    }
    const url = req.url.split('?')[0]
    if (url.startsWith('/api/') && !url.startsWith('/api/auth/') && !req.user) {
      return reply.code(401).send({ error: 'no autenticado' })
    }
  })

  app.get('/api/auth/status', async () => ({ setupRequired: userCount() === 0 }))

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'no autenticado' })
    return { id: req.user.id, username: req.user.username, is_admin: !!req.user.is_admin }
  })

  app.post('/api/auth/setup', async (req, reply) => {
    if (userCount() > 0) return reply.code(403).send({ error: 'ya configurado' })
    if (!validCreds(req.body)) return reply.code(400).send({ error: 'usuario o contraseña inválidos (mín. 8 caracteres)' })
    const { username, password } = req.body as { username: string; password: string }
    const id = db.prepare('INSERT INTO users(username, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)')
      .run(username, await hashPassword(password), Date.now()).lastInsertRowid as number
    createSession(req, reply, id)
    return { id, username, is_admin: true }
  })

  app.post('/api/auth/login', async (req, reply) => {
    const b = req.body as { username?: unknown; password?: unknown } | undefined
    if (!b || typeof b.username !== 'string' || typeof b.password !== 'string') {
      return reply.code(400).send({ error: 'datos inválidos' })
    }
    const key = failKey(req.ip, b.username)
    const f = fails.get(key)
    if (f && f.n >= 5 && f.until > Date.now()) return reply.code(429).send({ error: 'demasiados intentos, espera un minuto' })
    const row = db.prepare('SELECT id, username, is_admin, password_hash FROM users WHERE username = ?')
      .get(b.username) as (User & { password_hash: string }) | undefined
    // Se verifica siempre (hash ficticio si no existe) para no filtrar usuarios por tiempo
    const ok = await verifyPassword(b.password, row?.password_hash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64'))
    if (!row || !ok) {
      fails.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 60_000 })
      return reply.code(401).send({ error: 'credenciales incorrectas' })
    }
    fails.delete(key)
    createSession(req, reply, row.id)
    return { id: row.id, username: row.username, is_admin: !!row.is_admin }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    const token = readCookie(req, COOKIE)
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token))
    setSessionCookie(req, reply, '', 0)
    return { ok: true }
  })

  app.post('/api/auth/password', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'no autenticado' })
    const b = req.body as { current?: unknown; password?: unknown } | undefined
    if (!b || typeof b.current !== 'string' || typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 256) {
      return reply.code(400).send({ error: 'contraseña inválida (mín. 8 caracteres)' })
    }
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id) as { password_hash: string }
    if (!(await verifyPassword(b.current, row.password_hash))) return reply.code(403).send({ error: 'contraseña actual incorrecta' })
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(b.password), req.user.id)
    // Cierra el resto de sesiones
    const keep = readCookie(req, COOKIE)
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, keep ? sha(keep) : '')
    return { ok: true }
  })

  // --- gestión de usuarios (solo admin)
  const admin = (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user?.is_admin) { reply.code(403).send({ error: 'solo administradores' }); return false }
    return true
  }

  app.get('/api/users', async (req, reply) => {
    if (!admin(req, reply)) return
    return db.prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY username COLLATE NOCASE').all()
  })

  app.post('/api/users', async (req, reply) => {
    if (!admin(req, reply)) return
    if (!validCreds(req.body)) return reply.code(400).send({ error: 'usuario o contraseña inválidos (mín. 8 caracteres)' })
    const { username, password, is_admin } = req.body as { username: string; password: string; is_admin?: boolean }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      return reply.code(409).send({ error: 'el usuario ya existe' })
    }
    const id = db.prepare('INSERT INTO users(username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)')
      .run(username, await hashPassword(password), is_admin ? 1 : 0, Date.now()).lastInsertRowid
    return reply.code(201).send({ id, username, is_admin: !!is_admin })
  })

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    if (!admin(req, reply)) return
    const id = Number(req.params.id)
    if (id === req.user!.id) return reply.code(400).send({ error: 'no puedes borrarte a ti mismo' })
    const r = db.prepare('DELETE FROM users WHERE id = ?').run(id)
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'no encontrado' })
  })

  // Limpieza periódica de sesiones caducadas
  const timer = setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600_000)
  timer.unref()
}
