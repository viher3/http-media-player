import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { openDb } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { scan } from '../src/scanner.js'
import { normKey } from '../src/categorize.js'
import { parseLrc, srtToVtt } from '../src/extras.js'
import { ftsQuery } from '../src/routes/browse.js'

let root: string, tmp: string
const db = openDb(':memory:')
let app: ReturnType<typeof buildApp>
let cookie = ''

const ff = (out: string, args: string[]) => {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, out])
}
const tone = (out: string, ...meta: string[]) =>
  ff(out, ['-f', 'lavfi', '-i', 'sine=d=1', ...meta.flatMap((m) => ['-metadata', m])])

const req = (method: string, url: string, payload?: unknown, c = cookie) =>
  app.inject({ method: method as any, url, payload: payload as any, headers: c ? { cookie: c } : {} })
const j = async (method: string, url: string, payload?: unknown, c = cookie) => (await req(method, url, payload, c)).json()
const login = async (username: string, password: string) =>
  String((await req('POST', '/api/auth/login', { username, password }, '')).headers['set-cookie']).split(';')[0]

before(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v2-')))
  root = path.join(tmp, 'media')
  // sin etiquetas: se infiere Artista/Álbum/NN - Título
  tone(path.join(root, 'Banda', 'Disco Uno', '01 - Uno.mp3'))
  tone(path.join(root, 'Banda', 'Disco Uno', '02 - Dos.mp3'))
  ff(path.join(root, 'Banda', 'Disco Uno', 'cover.jpg'), ['-f', 'lavfi', '-i', 'color=c=red:s=300x300', '-frames:v', '1'])
  // con etiquetas y variantes del mismo artista
  tone(path.join(root, 'Tagged', 'x.mp3'), 'title=Come Together', 'artist=The Beatles', 'album=Abbey Road', 'genre=Rock', 'date=1969', 'track=1')
  tone(path.join(root, 'Tagged', 'y.mp3'), 'title=Something', 'artist=beatles', 'album=Abbey Road', 'genre=Rock', 'date=1969', 'track=2')
  fs.writeFileSync(path.join(root, 'Tagged', 'x.lrc'), '[ar:x]\n[00:01.50]Hola\n[00:03.00]Mundo\n')
  ff(path.join(root, 'Peli', 'film.mp4'),
    ['-f', 'lavfi', '-i', 'testsrc=d=1:s=64x64:r=10', '-f', 'lavfi', '-i', 'sine=d=1', '-shortest', '-pix_fmt', 'yuv420p'])
  fs.writeFileSync(path.join(root, 'Peli', 'film.es.srt'), '1\n00:00:00,500 --> 00:00:01,000\nHola\n')
  app = buildApp(db, { root, webDir: '/nonexistent' })
  await scan(db, root)
})
after(() => app.close())

test('normKey unifica variantes', () => {
  assert.equal(normKey('The Beatles'), normKey('beatles'))
  assert.equal(normKey('Sigur Rós'), normKey('sigur ros'))
  assert.equal(normKey('Simon & Garfunkel'), normKey('Simon and Garfunkel'))
})

test('helpers: lrc, srt, fts', () => {
  assert.deepEqual(parseLrc('[ar:x]\n[00:01.50]Hola\n[00:01.00][00:05]Eco'), [
    { t: 1, text: 'Eco' }, { t: 1.5, text: 'Hola' }, { t: 5, text: 'Eco' }])
  assert.equal(parseLrc('solo texto'), null)
  assert.match(srtToVtt('1\r\n00:00:01,500 --> 00:00:02,000\r\nHi'), /^WEBVTT\n\n1\n00:00:01\.500 --> 00:00:02\.000/)
  assert.equal(ftsQuery('foo "bar" -baz*'), '"foo"* "bar"* "baz"*')
  assert.equal(ftsQuery('   "" '), null)
})

test('API exige autenticación; setup solo una vez', async () => {
  assert.equal((await req('GET', '/api/folders', undefined, '')).statusCode, 401)
  assert.equal((await j('GET', '/api/auth/status', undefined, '')).setupRequired, true)
  assert.equal((await req('POST', '/api/auth/setup', { username: 'admin', password: 'short' }, '')).statusCode, 400)
  const r = await req('POST', '/api/auth/setup', { username: 'admin', password: 'password123' }, '')
  assert.equal(r.statusCode, 200)
  assert.match(String(r.headers['set-cookie']), /HttpOnly/)
  cookie = String(r.headers['set-cookie']).split(';')[0]
  assert.equal((await req('POST', '/api/auth/setup', { username: 'x', password: 'password123' }, '')).statusCode, 403)
  assert.equal((await j('GET', '/api/auth/me')).username, 'admin')
})

test('categorización: infiere desde carpetas y unifica variantes de artista', async () => {
  const artists = await j('GET', '/api/artists')
  assert.deepEqual(artists.map((a: any) => a.name).sort(), ['Banda', 'The Beatles'])
  const beatles = artists.find((a: any) => a.name === 'The Beatles')
  assert.equal(beatles.track_count, 2)
  assert.equal(beatles.album_count, 1)
  const albums = await j('GET', '/api/albums')
  assert.deepEqual(albums.map((a: any) => a.title).sort(), ['Abbey Road', 'Disco Uno'])
  const ab = albums.find((a: any) => a.title === 'Abbey Road')
  const detail = await j('GET', `/api/albums/${ab.id}`)
  assert.deepEqual(detail.tracks.map((t: any) => t.title), ['Come Together', 'Something'])
  assert.equal(detail.album.year, 1969)
  const du = albums.find((a: any) => a.title === 'Disco Uno')
  const d2 = await j('GET', `/api/albums/${du.id}`)
  assert.deepEqual(d2.tracks.map((t: any) => [t.title, t.track_no]), [['Uno', 1], ['Dos', 2]])
  const artist = await j('GET', `/api/artists/${beatles.id}`)
  assert.equal(artist.albums.length, 1)
  const genres = await j('GET', '/api/genres')
  assert.deepEqual(genres, [{ name: 'Rock', track_count: 2 }])
  assert.equal((await j('GET', '/api/genres/Rock')).tracks.length, 2)
  assert.equal((await j('GET', '/api/videos'))[0].folder_path, 'Peli')
})

test('carátulas: fichero de carpeta, miniaturas JPEG y sin carátula', async () => {
  const du = (await j('GET', '/api/albums')).find((a: any) => a.title === 'Disco Uno')
  assert.equal(du.has_cover, 1)
  const r = await req('GET', `/api/albums/${du.id}/cover?size=64`)
  assert.equal(r.statusCode, 200)
  assert.equal(r.headers['content-type'], 'image/jpeg')
  assert.ok(r.rawPayload[0] === 0xff && r.rawPayload[1] === 0xd8)
  const ab = (await j('GET', '/api/albums')).find((a: any) => a.title === 'Abbey Road')
  assert.equal((await req('GET', `/api/albums/${ab.id}/cover`)).statusCode, 404)
})

test('búsqueda FTS con prefijos y sin tildes', async () => {
  const r = await j('GET', '/api/search?q=' + encodeURIComponent('com tog'))
  assert.deepEqual(r.media.map((m: any) => m.title), ['Come Together'])
  assert.equal((await j('GET', '/api/search?q=abbey')).albums[0].title, 'Abbey Road')
  assert.equal((await j('GET', '/api/search?q=beat')).artists[0].name, 'The Beatles')
  const weird = await req('GET', '/api/search?q=' + encodeURIComponent('"*) OR 1=1 --'))
  assert.equal(weird.statusCode, 200)
})

test('subtítulos y letras', async () => {
  const film = (await j('GET', '/api/videos'))[0]
  const subs = await j('GET', `/api/media/${film.id}/subtitles`)
  assert.deepEqual(subs.map((s: any) => s.lang), ['es'])
  const vtt = await req('GET', `/api/media/${film.id}/subtitles/film.es.srt`)
  assert.match(vtt.body, /^WEBVTT/)
  assert.equal((await req('GET', `/api/media/${film.id}/subtitles/..%2F..%2Fetc%2Fpasswd`)).statusCode, 404)
  const x = (await j('GET', '/api/genres/Rock')).tracks.find((t: any) => t.title === 'Come Together')
  const ly = await j('GET', `/api/media/${x.id}/lyrics`)
  assert.deepEqual(ly.synced, [{ t: 1.5, text: 'Hola' }, { t: 3, text: 'Mundo' }])
  const y = (await j('GET', '/api/genres/Rock')).tracks.find((t: any) => t.title === 'Something')
  assert.deepEqual(await j('GET', `/api/media/${y.id}/lyrics`), { synced: null, text: null })
})

test('usuarios: admin crea, no-admin no puede, login con límite de intentos', async () => {
  assert.equal((await req('POST', '/api/users', { username: 'ana', password: 'password123' })).statusCode, 201)
  assert.equal((await req('POST', '/api/users', { username: 'ANA', password: 'password123' })).statusCode, 409)
  const ana = await login('ana', 'password123')
  assert.ok(ana)
  assert.equal((await req('GET', '/api/users', undefined, ana)).statusCode, 403)
  assert.equal((await req('POST', '/api/scan', undefined, ana)).statusCode, 403)
  await req('POST', '/api/users', { username: 'bob', password: 'password123' })
  for (let i = 0; i < 5; i++) assert.equal((await req('POST', '/api/auth/login', { username: 'bob', password: 'mal-mal-mal' }, '')).statusCode, 401)
  assert.equal((await req('POST', '/api/auth/login', { username: 'bob', password: 'password123' }, '')).statusCode, 429)
  // logout invalida la sesión
  assert.equal((await req('POST', '/api/auth/logout', undefined, ana)).statusCode, 200)
  assert.equal((await req('GET', '/api/folders', undefined, ana)).statusCode, 401)
})

test('playlists: CRUD, reordenar, aislamiento, export/import m3u8, no disponibles', async () => {
  const tracks = (await j('GET', '/api/albums')).length && (await j('GET', '/api/genres/Rock')).tracks
  const du = (await j('GET', '/api/albums')).find((a: any) => a.title === 'Disco Uno')
  const duTracks = (await j('GET', `/api/albums/${du.id}`)).tracks
  const ids = [tracks[0].id, duTracks[0].id, duTracks[1].id]

  const created = await j('POST', '/api/playlists', { name: ' Mezcla ', media_ids: ids })
  assert.equal(created.name, 'Mezcla')
  let pl = await j('GET', `/api/playlists/${created.id}`)
  assert.deepEqual(pl.items.map((i: any) => i.media.id), ids)

  const order = pl.items.map((i: any) => i.item_id).reverse()
  assert.equal((await req('PUT', `/api/playlists/${created.id}/order`, { item_ids: order })).statusCode, 200)
  assert.equal((await req('PUT', `/api/playlists/${created.id}/order`, { item_ids: order.slice(1) })).statusCode, 400)
  pl = await j('GET', `/api/playlists/${created.id}`)
  assert.deepEqual(pl.items.map((i: any) => i.media.id), [...ids].reverse())

  assert.equal((await j('POST', `/api/playlists/${created.id}/items`, { media_ids: [ids[0], 999999] })).added, 1)
  pl = await j('GET', `/api/playlists/${created.id}`)
  assert.equal(pl.items.length, 4)
  assert.equal((await req('DELETE', `/api/playlists/${created.id}/items/${pl.items[3].item_id}`)).statusCode, 200)

  // aislamiento entre usuarios
  const ana = await login('ana', 'password123')
  assert.equal((await req('GET', `/api/playlists/${created.id}`, undefined, ana)).statusCode, 404)
  assert.deepEqual(await j('GET', '/api/playlists', undefined, ana), [])

  // export / import
  const exp = await req('GET', `/api/playlists/${created.id}/export.m3u8`)
  assert.match(exp.headers['content-type'] as string, /mpegurl/)
  assert.match(exp.body, /^#EXTM3U/)
  assert.match(exp.body, /Banda\/Disco Uno\/02 - Dos\.mp3/)
  const m3u = exp.body.replace('Banda/Disco Uno/02 - Dos.mp3', 'C:\\Music\\Disco Uno\\02 - Dos.mp3') + '\nnoexiste/fantasma.mp3\n'
  const imp = await j('POST', '/api/playlists/import', { name: 'Importada', m3u })
  assert.equal(imp.matched, 3)
  assert.equal(imp.missing, 1)
  const imported = await j('GET', `/api/playlists/${imp.id}`)
  assert.equal(imported.items.length, 4)
  assert.equal(imported.items[3].available, false)

  // un fichero desaparece -> "no disponible", y vuelve -> disponible de nuevo
  const gone = path.join(root, 'Banda', 'Disco Uno', '02 - Dos.mp3')
  const backup = fs.readFileSync(gone)
  fs.rmSync(gone)
  await scan(db, root)
  pl = await j('GET', `/api/playlists/${created.id}`)
  assert.deepEqual(pl.items.map((i: any) => i.available), [false, true, true])
  assert.equal(pl.items[0].title, 'Dos')
  fs.writeFileSync(gone, backup)
  await scan(db, root)
  pl = await j('GET', `/api/playlists/${created.id}`)
  assert.deepEqual(pl.items.map((i: any) => i.available), [true, true, true])

  assert.equal((await req('PATCH', `/api/playlists/${created.id}`, { name: 'Nueva' })).statusCode, 200)
  assert.equal((await req('DELETE', `/api/playlists/${created.id}`)).statusCode, 200)
  assert.equal((await req('GET', `/api/playlists/${created.id}`)).statusCode, 404)
})

test('favoritos, historial, listas automáticas y reanudación (por usuario)', async () => {
  const [a, b] = (await j('GET', '/api/genres/Rock')).tracks
  assert.equal((await req('PUT', `/api/favorites/${a.id}`)).statusCode, 200)
  await req('PUT', `/api/favorites/${a.id}`)
  assert.deepEqual(await j('GET', '/api/favorites/ids'), [a.id])
  assert.equal((await j('GET', '/api/favorites')).length, 1)
  const ana = await login('ana', 'password123')
  assert.deepEqual(await j('GET', '/api/favorites/ids', undefined, ana), [])
  await req('DELETE', `/api/favorites/${a.id}`)
  assert.deepEqual(await j('GET', '/api/favorites/ids'), [])

  await req('POST', '/api/history', { media_id: a.id })
  await req('POST', '/api/history', { media_id: a.id })
  await req('POST', '/api/history', { media_id: b.id })
  assert.deepEqual((await j('GET', '/api/lists/most-played')).map((m: any) => [m.id, m.plays]), [[a.id, 2], [b.id, 1]])
  assert.equal((await j('GET', '/api/lists/recently-played'))[0].id, b.id)
  assert.deepEqual(await j('GET', '/api/lists/recently-played', undefined, ana), [])
  assert.ok((await j('GET', '/api/lists/recently-added')).length >= 5)

  const film = (await j('GET', '/api/videos'))[0]
  assert.equal((await j('GET', `/api/resume/${film.id}`)).position_ms, 0)
  await req('PUT', `/api/resume/${film.id}`, { position_ms: 30000, duration_ms: 600000 })
  assert.equal((await j('GET', `/api/resume/${film.id}`)).position_ms, 30000)
  assert.equal((await j('GET', `/api/resume/${film.id}`, undefined, ana)).position_ms, 0)
  await req('PUT', `/api/resume/${film.id}`, { position_ms: 598000, duration_ms: 600000 })
  assert.equal((await j('GET', `/api/resume/${film.id}`)).position_ms, 0)
})
