import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { openDb } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { scan } from '../src/scanner.js'

let root: string
const db = openDb(':memory:')
let app: ReturnType<typeof buildApp>
let cookie = ''

function ffmpeg(out: string, args: string[]) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, out])
}

before(async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'api-')))
  root = path.join(tmp, 'media')
  fs.mkdirSync(path.join(root, 'Rock'), { recursive: true })
  ffmpeg(path.join(root, 'Rock', 'a.mp3'),
    ['-f', 'lavfi', '-i', 'sine=d=1', '-metadata', 'title=Canción A', '-metadata', 'artist=Banda'])
  ffmpeg(path.join(root, 'b.mp4'),
    ['-f', 'lavfi', '-i', 'testsrc=d=1:s=64x64:r=10', '-f', 'lavfi', '-i', 'sine=d=1', '-shortest', '-pix_fmt', 'yuv420p'])
  fs.writeFileSync(path.join(root, 'notes.txt'), 'ignorar')
  fs.mkdirSync(path.join(tmp, 'outside'))
  fs.writeFileSync(path.join(tmp, 'outside', 'secret.mp3'), 'x')
  fs.symlinkSync(path.join(tmp, 'outside'), path.join(root, 'evil'))
  app = buildApp(db, { root, webDir: '/nonexistent' })
  await scan(db, root)
  const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'admin', password: 'password123' } })
  cookie = String(r.headers['set-cookie']).split(';')[0]
})

const get = (url: string, extra: Record<string, string> = {}) =>
  app.inject({ url, headers: { cookie, ...extra } })
after(() => app.close())

test('escaneo indexa carpetas, metadatos y omite symlinks externos / otros ficheros', async () => {
  const res = await get('/api/folders')
  const root_ = res.json()
  assert.deepEqual(root_.folders.map((f: any) => f.name), ['Rock'])
  assert.deepEqual(root_.media.map((m: any) => m.filename), ['b.mp4'])
  assert.equal(root_.media[0].kind, 'video')
  const rock = (await get('/api/folders/by-path?p=Rock')).json()
  assert.equal(rock.media[0].title, 'Canción A')
  assert.equal(rock.media[0].artist, 'Banda')
  assert.ok(rock.media[0].duration_ms > 800)
  assert.deepEqual(rock.breadcrumb.map((b: any) => b.name), ['Biblioteca', 'Rock'])
})

test('stream con Range', async () => {
  const rock = (await get('/api/folders/by-path?p=Rock')).json()
  const id = rock.media[0].id
  const size = fs.statSync(path.join(root, 'Rock', 'a.mp3')).size
  const full = await get(`/api/media/${id}/stream`)
  assert.equal(full.statusCode, 200)
  assert.equal(full.headers['accept-ranges'], 'bytes')
  assert.equal(full.rawPayload.length, size)
  const part = await get(`/api/media/${id}/stream`, { range: 'bytes=10-19' })
  assert.equal(part.statusCode, 206)
  assert.equal(part.headers['content-range'], `bytes 10-19/${size}`)
  assert.deepEqual(part.rawPayload, full.rawPayload.subarray(10, 20))
  const bad = await get(`/api/media/${id}/stream`, { range: `bytes=${size + 5}-` })
  assert.equal(bad.statusCode, 416)
})

test('path traversal rechazado', async () => {
  for (const p of ['../outside', '..%2Foutside', 'evil', 'Rock/../../outside']) {
    const r = await get(`/api/folders/by-path?p=${p}`)
    assert.ok(r.statusCode >= 400 && r.statusCode < 500, `${p} -> ${r.statusCode}`)
  }
})

test('reescaneo incremental refleja altas y bajas sin duplicar', async () => {
  fs.copyFileSync(path.join(root, 'Rock', 'a.mp3'), path.join(root, 'Rock', 'c.mp3'))
  fs.rmSync(path.join(root, 'b.mp4'))
  await scan(db, root)
  await scan(db, root)
  assert.equal((db.prepare('SELECT COUNT(*) n FROM media').get() as any).n, 2)
  const rock = (await get('/api/folders/by-path?p=Rock')).json()
  assert.deepEqual(rock.media.map((m: any) => m.filename).sort(), ['a.mp3', 'c.mp3'])
  assert.equal((await get('/api/folders')).json().media.length, 0)
})
