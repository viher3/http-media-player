# HTTP Media Player

Self-hosted web player for a folder of audio and video files. See [SPEC.md](SPEC.md).

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
# or with Docker:
docker build -t http-media-player .
docker run -p 8080:8080 -v /path/to/media:/media:ro -v mp-data:/data http-media-player
```

Environment variables: `MEDIA_DIR` (default `./media`), `DATA_DIR` (default `./data`), `PORT` (default 8080), `WEB_DIR`.
