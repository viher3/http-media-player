import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './config.js'

export function openDb(file = path.join(DATA_DIR, 'library.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY,
      folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      kind TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      duration_ms INTEGER,
      title TEXT, artist TEXT, album_artist TEXT, album TEXT,
      track_no INTEGER, disc_no INTEGER, year INTEGER, genre TEXT,
      has_cover INTEGER NOT NULL DEFAULT 0,
      scanned_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_folder ON media(folder_id);
  `)
  return db
}
export type Db = ReturnType<typeof openDb>
