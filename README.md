# Radar Nostr

Feed en vivo de qué apps/clientes de Nostr se están usando, minuto a minuto. Estilo zaplife.lol, pero de apps.

## Correr

```bash
npm install
npm run dev
# http://localhost:3000
```

Deploy: tal cual a Vercel (todo corre en el navegador, no hay backend).

## Cómo detecta la actividad

1. **Tag `client` (NIP-89)**: si el evento lo trae, se atribuye a esa app. Si apunta a un `31990:pubkey:d`, se baja la ficha de la app (nombre, logo, web).
2. **Tipo de evento (kind)**: si no hay tag, se clasifica por categoría (foto, artículo, live, git, DVM…). Ver `lib/kinds.js`.
3. **Ecosistema**: apps nuevas (kind 31990 publicados en vivo) y zaps a npubs de apps conocidas.
4. **Zaps**: el recibo (9735) lo firma el servidor Lightning, así que la app se lee del pedido de zap que va adentro (tag `description`). Un zap cuenta para la app que lo recibe o, si va a una persona, para la app desde la que se mandó. Los que no tienen ninguna de las dos se descartan.

Al arrancar precarga ~500 fichas 31990 (para reconocer zaps a apps) y trae los últimos 5 minutos de eventos, así la pantalla no empieza vacía.

## Archivos

- `lib/useRadar.js`: conexión a relays (NDK), parseo, agregados, perfiles en lote. Lo importante está acá.
- `lib/kinds.js`: mapa kind -> categoría/verbo. Agregá kinds acá.
- `lib/bots.js`: detección de bots (por nombre de app, por perfil `"bot": true` y por ritmo de publicación). Sus eventos no cuentan en ningún lado.
- `lib/knownApps.js`: apps conocidas (nombre + web, el logo sale del favicon) y normalización de nombres para que "Primal Android" y "Primal Web" sean una sola burbuja. Agregá apps acá.
- `components/Bubbles.js`: burbujas por app (área = actividad últimos 5 min, laten con cada evento). Se acomodan solas con una simulación chica (atracción al centro + choques) que se duerme cuando todo está quieto. Tocar una abre el detalle.
- `components/AppDetail.js`: panel con el detalle de una app (web, actividad 5 min / hora / 24 h, últimos eventos).
- `components/Ranking.js`: top 10 de la última hora y de 24 h. Se cuenta en tramos de 10 min y se guarda en `localStorage`, así que solo refleja lo que este navegador vio con la página abierta.
- `components/Feed.js`: ticker en vivo (cada item abre el evento en njump.me).
- `components/Pulse.js`: barras por minuto apiladas por categoría; la leyenda filtra el feed.

## Ajustes rápidos

- Relays: `RELAYS` (escucha en vivo) y `PROFILE_RELAYS` (perfiles) en `lib/useRadar.js`.
- Ventana de burbujas / largo del feed: constantes al principio de `lib/useRadar.js`.
- Las reacciones (kind 7) están excluidas porque inundan todo; agregalas a `WATCHED_KINDS` si las querés.

## Próximos pasos (v2)

- Worker en Node en el nodo Umbrel escuchando 24/7 + Supabase para rankings diarios/semanales e historial.
- Ranking real (no por navegador) cuando exista el worker + Supabase.
