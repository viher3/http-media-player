# HTTP Media Player

Reproductor web autoalojado para una carpeta de audio/vídeo. Ver [SPEC.md](SPEC.md).

## Desarrollo
```bash
npm install
MEDIA_DIR=/ruta/a/medios npm run dev:server   # API en :8080
npm run dev:web                               # SPA en :5173 (proxy a :8080)
npm test
```

## Producción
```bash
npm run build && MEDIA_DIR=/ruta/a/medios npm start
# o con Docker:
docker build -t http-media-player .
docker run -p 8080:8080 -v /ruta/a/medios:/media:ro -v mp-data:/data http-media-player
```

Variables: `MEDIA_DIR` (def. `./media`), `DATA_DIR` (def. `./data`), `PORT` (def. 8080), `WEB_DIR`.
