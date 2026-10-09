import type { FastifyInstance } from 'fastify'
import { scanEvents, scanStatus } from '../scanner.js'

/** Canal SSE: estado del escaneo y aviso de biblioteca actualizada. */
export function registerEvents(app: FastifyInstance) {
  app.get('/api/events', (req, reply) => {
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    })
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    send('scan', scanStatus)
    const onProgress = (s: unknown) => send('scan', s)
    const onDone = (s: unknown) => send('library', s)
    scanEvents.on('progress', onProgress)
    scanEvents.on('done', onDone)
    const hb = setInterval(() => res.write(': ping\n\n'), 25_000)
    req.raw.on('close', () => {
      clearInterval(hb)
      scanEvents.off('progress', onProgress)
      scanEvents.off('done', onDone)
    })
  })
}
