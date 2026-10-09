# HTTP Media Player

Self-hosted web player for a folder of audio and video files. Specs live in [specs/](specs/).

## Features
- Library scan with tag reading, incremental rescans and a **live folder watcher**
- Automatic categorisation into **artists, albums, genres** (with inference from `Artist/Album/NN - Title.ext` when tags are missing)
- Folder browser, instant **full-text search** (SQLite FTS5), covers (embedded or `cover.jpg`/`folder.jpg`) with cached thumbnails
- Persistent player (never interrupted by navigation): queue, shuffle, repeat, near-gapless transitions, Media Session, keyboard shortcuts, synced lyrics (`.lrc` or embedded), optional visualizer, video with subtitles (`.srt`/`.vtt`)
- **Playlists** (drag & drop, `.m3u8` import/export), favourites, recently/most played, resume position for videos and long audio
- **Multi-user** accounts with per-user state, light/dark theme, installable PWA

## Development
```bash
npm install
MEDIA_DIR=/path/to/media npm run dev:server   # API on :8080
npm run dev:web                               # SPA on :5173 (proxies to :8080)
npm test
```

## Production
```bash
npm run build && MEDIA_DIR=/path/to/media npm start
# or with Docker Compose (see below), or plain Docker:
docker build -t http-media-player .
docker run -p 8080:8080 -v /path/to/media:/media:ro -v mp-data:/data http-media-player
```

On first start, open the app and create the **administrator** account. Admins can add more users (menu → Users) and trigger rescans.

### Docker Compose
```bash
MEDIA_PATH=/path/to/media docker compose up -d --build   # http://localhost:8080
```
`MEDIA_PATH` defaults to `./media` and `PORT` to `8080`; both can also go in a `.env` file (`cp .env.dist .env`).

### Configuration
| Variable | Default | Description |
|---|---|---|
| `MEDIA_DIR` | `./media` | Folder with your media (`/media` in Docker) |
| `DATA_DIR` | `./data` | SQLite database and cover cache (`/data` in Docker) |
| `PORT` | `8080` | HTTP port |
| `WEB_DIR` | `web/dist` | Built SPA to serve |
| `WATCH` | `1` | Set `0` to disable the live folder watcher |
| `WATCH_POLLING` | `0` | Set `1` on network volumes (NFS/SMB) where inotify does not work |
| `WATCH_POLL_INTERVAL_MS` | `5000` | Polling interval when `WATCH_POLLING=1` |
| `WATCH_DEBOUNCE_MS` | `3000` | Quiet period before an automatic rescan |
| `TRUST_PROXY` | `0` | Set `1` behind a reverse proxy so cookies get `Secure` and rate limiting sees real client IPs |

Serve it over HTTPS (reverse proxy) if it is exposed beyond your LAN: sessions use an `HttpOnly`, `SameSite=Lax` cookie.

## Tech stack
- **Backend:** Node.js, TypeScript, [Fastify](https://fastify.dev) (with `@fastify/static` to serve the SPA)
- **Metadata & images:** [music-metadata](https://github.com/Borewit/music-metadata) (tags, duration, embedded covers), [sharp](https://sharp.pixelplumbing.com) (thumbnails)
- **Watching:** [chokidar](https://github.com/paulmillr/chokidar); updates pushed to the UI via Server-Sent Events
- **Auth:** scrypt password hashing (Node `crypto`), server-side sessions
- **Frontend:** React, Vite, React Router, Zustand; two persistent HTML5 `<video>` elements (active + preloading standby) play both audio and video
- **Tests:** Node's built-in test runner via `tsx` (unit + API integration)
- **Packaging:** npm workspaces (`server`, `web`), Docker / Docker Compose

## Database
[SQLite](https://www.sqlite.org) through [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), stored in `DATA_DIR/library.db` (`/data` in Docker, persisted in the `media-player-data` volume). Tables: library index (`folders`, `media`, `artists`, `albums`, `media_fts`) and user data (`users`, `sessions`, `playlists`, `playlist_items`, `favorites`, `play_history`, `resume`). Playlists, favourites and history reference files by path, so they survive a file disappearing and coming back. The media files themselves are never modified.
