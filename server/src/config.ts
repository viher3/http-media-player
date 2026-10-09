import path from 'node:path'
import fs from 'node:fs'

const mediaDir = path.resolve(process.env.MEDIA_DIR ?? './media')
fs.mkdirSync(mediaDir, { recursive: true })
export const MEDIA_DIR = fs.realpathSync(mediaDir)
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? './data')
export const PORT = Number(process.env.PORT ?? 8080)
export const WEB_DIR = path.resolve(process.env.WEB_DIR ?? path.join(import.meta.dirname, '../../web/dist'))

export const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wav'])
export const VIDEO_EXT = new Set(['mp4', 'm4v', 'webm', 'ogv', 'mkv'])

export const MIME: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mkv: 'video/x-matroska',
}
