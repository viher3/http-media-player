import { buildApp } from './app.js'
import { openDb } from './db.js'
import { MEDIA_DIR, PORT } from './config.js'
import { scan } from './scanner.js'

const db = openDb()
const app = buildApp(db)
await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`Escuchando en :${PORT}, biblioteca: ${MEDIA_DIR}`)
scan(db).then(() => console.log('Escaneo inicial completado')).catch((e) => console.error(e))
