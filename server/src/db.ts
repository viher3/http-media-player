import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './config.js'

export function openDb(file = path.join(DATA_DIR, 'library.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}
export type Db = ReturnType<typeof openDb>

const hasColumn = (db: Database.Database, table: string, col: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col)

function migrate(db: Database.Database) {
  // --- v1: biblioteca (MVP)
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

  // --- v2: categorización, usuarios, playlists, estado por usuario
  db.exec(`
    CREATE TABLE IF NOT EXISTS artists (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      year INTEGER,
      cover_media_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);
  `)
  if (!hasColumn(db, 'media', 'artist_id')) db.exec('ALTER TABLE media ADD COLUMN artist_id INTEGER')
  if (!hasColumn(db, 'media', 'album_id')) db.exec('ALTER TABLE media ADD COLUMN album_id INTEGER')
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_media_artist ON media(artist_id);
    CREATE INDEX IF NOT EXISTS idx_media_album ON media(album_id);
    CREATE INDEX IF NOT EXISTS idx_media_genre ON media(genre);
    CREATE INDEX IF NOT EXISTS idx_media_scanned ON media(scanned_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
      title, artist, album, filename, tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    -- Las referencias a ficheros se guardan por ruta (no por media.id) para sobrevivir
    -- a que un fichero desaparezca y vuelva a aparecer.
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);
    CREATE TABLE IF NOT EXISTS playlist_items (
      id INTEGER PRIMARY KEY,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      path TEXT NOT NULL,
      title_cache TEXT,
      artist_cache TEXT,
      duration_cache INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pitems_playlist ON playlist_items(playlist_id, position);

    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, path)
    );
    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      played_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_user ON play_history(user_id, played_at);
    CREATE TABLE IF NOT EXISTS resume (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      position_ms INTEGER NOT NULL,
      duration_ms INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, path)
    );
  `)
}
