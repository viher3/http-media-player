# HTTP Media Player — Especificación

Aplicación web autoalojada que escanea una carpeta de medios (`/media`), indexa audio y vídeo reproducible por HTML5 y lo sirve a un reproductor persistente (estilo Spotify).

---

## 1. Decisiones de arquitectura (comunes a MVP y V2)

| Aspecto | Decisión | Motivo |
|---|---|---|
| Backend | Node.js 22 + Fastify + TypeScript | Streaming con Range simple, ecosistema de metadatos |
| BD | SQLite (`better-sqlite3`) en `/data/library.db` | Sin servicios extra, suficiente para decenas de miles de ficheros |
| Metadatos | `music-metadata` (ID3, Vorbis, MP4 atoms, duración, carátula embebida) | Pure JS, sin dependencias nativas |
| Frontend | SPA React + Vite + React Router + Zustand | El reproductor vive **fuera** del `<Outlet>` del router, así no se desmonta al navegar |
| Despliegue | Un único contenedor Docker; el backend sirve la SPA estática y la API | `docker run -v /mis/medios:/media:ro -v appdata:/data -p 8080:8080` |
| Medios | Montados en solo lectura en `/media` (ruta configurable con `MEDIA_DIR`) | La app nunca modifica los ficheros |

### Formatos soportados
Se indexa por extensión y se clasifica en `audio` o `video`:

- Audio: `mp3, m4a, aac, ogg, oga, opus, flac, wav`
- Vídeo: `mp4, m4v, webm, ogv, mkv` (mkv/otros contenedores: se indexan, pero la reproducibilidad depende del códec y del navegador)
- Se comprueba en cliente con `canPlayType()`; si no es reproducible se muestra un aviso en lugar de fallar en silencio.
- Fuera de alcance (V1 y V2): transcodificación. Se contempla en V3 (ver §5).

### Modelo de datos (SQLite)

```
folders(id, parent_id, path UNIQUE, name)
media(id, folder_id, path UNIQUE, filename, kind[audio|video], mime,
      size, mtime, duration_ms,
      title, artist, album_artist, album, track_no, disc_no, year, genre,
      has_cover, scanned_at)
```
V2 añade: `artists`, `albums`, `playlists`, `playlist_items`, `users`, `play_history`.

---

## 2. MVP

**Objetivo:** apuntar la app a una carpeta, navegarla por su estructura de directorios y reproducir cualquier fichero con un reproductor siempre visible.

### 2.1 Funcionalidad

**Escaneo e indexado**
- Al arrancar se recorre `MEDIA_DIR` recursivamente y se puebla la BD.
- Reescaneo incremental: solo se vuelven a leer ficheros cuyo `mtime`/`size` cambió; los desaparecidos se eliminan del índice.
- Botón/endpoint "Reescanear" manual (`POST /api/scan`) con estado de progreso (`GET /api/scan/status`).
- Se leen metadatos si existen; si no, `title` = nombre de fichero sin extensión.
- Ficheros ilegibles o corruptos se registran en log y se saltan sin detener el escaneo.

**Navegación por carpetas**
- Vista de explorador: breadcrumb + lista de subcarpetas y ficheros de la carpeta actual.
- Ruta de la SPA refleja la carpeta (`/browse/Musica/Rock`) → enlaces compartibles y botón atrás funcional.
- Cada fila muestra: icono audio/vídeo, título (o nombre), duración, tamaño.
- Orden por nombre (carpetas primero).
- Acciones: reproducir un fichero; "Reproducir carpeta" (cola con los ficheros de esa carpeta).

**Reproductor persistente**
- Barra fija inferior presente en todas las rutas: carátula/icono, título, artista, play/pausa, anterior/siguiente, barra de progreso con seek, tiempo actual/total, volumen/mute.
- **Una sola instancia** de `<audio>`/`<video>` montada en la raíz de la app; navegar nunca interrumpe la reproducción.
- Cola de reproducción simple: al reproducir un fichero se encola el resto de su carpeta; al terminar pasa al siguiente.
- Vídeo: al reproducir un vídeo aparece un panel con el `<video>` (expandible a pantalla completa); al navegar se reduce a mini-ventana flotante sobre la barra, sin perder posición.
- Integración `Media Session API` (teclas multimedia, controles en pantalla de bloqueo/notificaciones del SO).
- Persistencia local (`localStorage`): último elemento, posición, volumen y cola, restaurados al recargar (sin autoplay).

**Streaming**
- `GET /api/media/:id/stream` sirve el fichero con soporte completo de **HTTP Range** (206 Partial Content), `Content-Type` correcto y `Accept-Ranges: bytes`, necesario para el seek.
- `GET /api/media/:id/cover` devuelve la carátula embebida (o 404).

### 2.2 API del MVP

```
GET  /api/folders/:id?            → carpeta (raíz si omitido) + subcarpetas + media
GET  /api/folders/by-path?p=...   → resolución de ruta para URLs de la SPA
GET  /api/media/:id               → ficha de un fichero
GET  /api/media/:id/stream        → bytes con Range
GET  /api/media/:id/cover         → imagen
POST /api/scan                    → lanza reescaneo
GET  /api/scan/status             → { running, processed, total, errors }
```

### 2.3 Seguridad (obligatorio ya en MVP)
- Ningún endpoint acepta rutas del cliente; todo se resuelve por `id` de BD.
- Para `by-path`, normalizar y verificar que el resultado queda dentro de `MEDIA_DIR` (prevención de path traversal); resolver symlinks con `realpath` y rechazar los que salgan del directorio.
- Sin autenticación en el MVP: documentar que debe ejecutarse en red local o tras un proxy con auth.

### 2.4 Requisitos no funcionales
- Escaneo inicial de 10.000 ficheros en menos de ~2 min en disco local.
- Listados de carpeta < 100 ms (índices en `folders.parent_id`, `media.folder_id`).
- Responsive: usable en móvil (la barra del reproductor se compacta; tap para expandir).
- Tests: unitarios del parser de Range y del resolutor de rutas; test de integración del escaneo con un directorio de fixtures.

### 2.5 Criterios de aceptación
1. Con `/media` montado, tras el arranque aparece el árbol de carpetas real.
2. Reproducir un mp3, un mp4 y un flac (si el navegador lo soporta) desde el explorador.
3. Navegar entre carpetas y a otras vistas **sin cortar el sonido ni perder la posición**.
4. Seek en la barra de progreso funciona (Range) en audio y vídeo.
5. Añadir/borrar un fichero en `/media` y pulsar "Reescanear" lo refleja sin duplicados.
6. Recargar la página restaura el elemento y la posición, en pausa.
7. Una petición con `../` o symlink externo devuelve 4xx, nunca contenido fuera de `/media`.

### 2.6 Estructura de repositorio sugerida
```
/server   src/{index,scanner,db,routes/*,streaming}.ts
/web      src/{app/Player,pages/Browse,store/player.ts}
/Dockerfile
/SPEC.md
```

---

## 3. Versión 2 — Biblioteca completa

### 3.1 Categorización automática (backend)
- Tras leer metadatos se construyen entidades **Artista → Álbum → Pista** (normalizando mayúsculas, espacios, "The ", `album_artist` vs `artist` para compilaciones).
- Agrupación por **género**, **año/década** y "recién añadidos".
- Fallback para ficheros sin etiquetas: inferir artista/álbum de la estructura `Artista/Álbum/NN - Título.ext` mediante reglas configurables.
- Los vídeos se tratan como una sección separada ("Vídeos"), con carpeta como agrupación principal y, opcionalmente, patrones de series (`SxxExx`).
- Carátulas: embebida → `cover.jpg|folder.jpg` en la carpeta → placeholder. Miniaturas redimensionadas y cacheadas (`sharp`) en varios tamaños.
- Endpoints: `/api/artists`, `/api/artists/:id`, `/api/albums`, `/api/albums/:id`, `/api/genres`.

### 3.2 Vistas nuevas
- Pestañas de biblioteca: **Carpetas · Artistas · Álbumes · Géneros · Vídeos · Playlists**.
- Búsqueda global instantánea (SQLite FTS5 sobre título, artista, álbum, nombre de fichero) con atajo `/`.
- Página de álbum/artista con reproducción completa y por pista.

### 3.3 Listas de reproducción
- CRUD de playlists: crear, renombrar, borrar, añadir/quitar pistas (desde cualquier lista vía menú contextual "Añadir a playlist…"), reordenar con drag & drop.
- Persistencia en backend (`playlists`, `playlist_items(position)`), por usuario.
- Reproducir playlist completa, aleatoria o desde una pista.
- Referencias por `media_id`; si un fichero desaparece del disco, la entrada se marca "no disponible" en lugar de borrarse (por si vuelve).
- Importar/exportar `.m3u8`.

### 3.4 Cola de reproducción avanzada
- Panel de cola: ver, reordenar, quitar, "reproducir a continuación", "añadir al final".
- Modos **shuffle** y **repeat** (off / todo / una).
- Reproducción **gapless** básica en audio (precarga de la siguiente pista).

### 3.5 Usuarios y estado
- Autenticación simple (usuario/contraseña con argon2, sesión por cookie HttpOnly) y registro por parte de un admin.
- Estado por usuario en backend: playlists, favoritos, historial, y **posición de reanudación** para vídeos/podcasts (sincroniza entre dispositivos).
- Favoritos (❤) y listas automáticas: "Más escuchadas", "Reproducidas recientemente".

### 3.6 Detección de cambios en vivo
- `chokidar` (o polling configurable para volúmenes de red) para indexar altas/bajas/modificaciones sin pulsar reescanear; actualización de la UI por SSE.

### 3.7 UX
- Visor de pantalla completa "Now Playing" (carátula grande, cola, letras si hay etiqueta `lyrics`/fichero `.lrc`).
- Ecualizador visual opcional (Web Audio `AnalyserNode`).
- Atajos de teclado: espacio, ←/→ (seek), ↑/↓ (volumen), `n`/`p`, `m`.
- Tema claro/oscuro, PWA instalable.
- Soporte de subtítulos de vídeo (`.srt`/`.vtt` junto al fichero, convertidos a WebVTT al vuelo).

### 3.8 Criterios de aceptación de V2
1. Una biblioteca de 1.000 álbumes etiquetados aparece correctamente agrupada por artista/álbum sin intervención manual.
2. Crear una playlist mixta de pistas de distintas carpetas, reordenarla y reproducirla con la app recargada entre medias.
3. La búsqueda devuelve resultados en < 150 ms sobre 50.000 pistas.
4. Dos usuarios tienen playlists y posiciones de reanudación independientes.
5. Copiar un álbum nuevo a `/media` lo hace aparecer en < 30 s sin acción manual.
6. Gapless: sin silencio audible entre pistas consecutivas del mismo formato.

---

## 4. Plan de entrega

| Hito | Contenido | Resultado |
|---|---|---|
| M1 | Esqueleto Fastify + SQLite + escáner con metadatos | `GET /api/folders` devuelve el árbol |
| M2 | Streaming con Range + test | Se reproduce con `curl`/`<audio>` crudo |
| M3 | SPA: explorador + reproductor persistente + cola de carpeta | **MVP funcional** |
| M4 | Media Session, persistencia local, vídeo mini-ventana, Docker | **MVP cerrado** |
| M5 | Artistas/álbumes/géneros + carátulas + búsqueda FTS | Biblioteca categorizada |
| M6 | Usuarios + playlists + favoritos/historial | **V2 núcleo** |
| M7 | Watcher, gapless, Now Playing, subtítulos, PWA | **V2 completa** |

## 5. Fuera de alcance / futuro (V3)
- Transcodificación con ffmpeg bajo demanda (mkv/HEVC/flac → AAC/H.264, HLS) y selección de calidad.
- Descarga de metadatos externos (MusicBrainz, TMDB) y scrobbling (Last.fm).
- Casting (Chromecast / DLNA), apps móviles nativas.
- Edición de etiquetas desde la UI.

## 6. Riesgos y notas
- **Compatibilidad de códecs:** el navegador decide; sin transcodificación habrá ficheros indexados no reproducibles. Mitigación: avisar con `canPlayType` y priorizar V3 si es frecuente.
- **Etiquetas inconsistentes** (artistas con variantes de escritura): la normalización será heurística; prever una tabla de alias editable.
- **Volúmenes de red (NFS/SMB):** inotify no funciona → polling configurable.
- **Navegadores móviles** pausan el audio en segundo plano si no hay Media Session correctamente configurada: es parte del MVP por ese motivo.
