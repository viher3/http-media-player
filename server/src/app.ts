import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from './db.js'
import { MEDIA_DIR, WEB_DIR } from './config.js'
import { registerAuth } from './auth.js'
import { registerLibrary } from './routes/library.js'
import { registerBrowse } from './routes/browse.js'
import { registerPlaylists } from './routes/playlists.js'
import { registerUserState } from './routes/user.js'
import { registerEvents } from './routes/events.js'

export function buildApp(db: Db, opts: { root?: string; webDir?: string } = {}) {
  const root = opts.root ?? MEDIA_DIR
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024, trustProxy: process.env.TRUST_PROXY === '1' })

  registerAuth(app, db)
  registerLibrary(app, db, root)
  registerBrowse(app, db)
  registerPlaylists(app, db)
  registerUserState(app, db)
  registerEvents(app)

  // SPA estática
  const webDir = opts.webDir ?? WEB_DIR
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    app.register(fastifyStatic, { root: webDir })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'no encontrado' })
      return reply.sendFile('index.html')
    })
  }
  return app
}
