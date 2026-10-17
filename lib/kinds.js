// Mapa de kinds -> categoría de actividad.
// Sirve como "capa 2": cuando el evento no trae tag `client`,
// el tipo de evento igual nos dice qué tipo de app se está usando.

export const CATEGORIES = {
  social: { label: "Social", color: "#a78bfa" },
  foto: { label: "Fotos", color: "#f472b6" },
  video: { label: "Video", color: "#fb7185" },
  articulo: { label: "Artículos", color: "#fbbf24" },
  live: { label: "En vivo", color: "#f87171" },
  dev: { label: "Dev / Git", color: "#34d399" },
  dvm: { label: "DVMs", color: "#22d3ee" },
  musica: { label: "Música", color: "#e879f9" },
  mercado: { label: "Mercado", color: "#a3e635" },
  zap: { label: "Zaps", color: "#f7931a" },
  ecosistema: { label: "Ecosistema", color: "#60a5fa" },
  otro: { label: "Otros", color: "#94a3b8" },
};

const KIND_MAP = {
  1: { cat: "social", verb: "publicó una nota" },
  6: { cat: "social", verb: "reposteó" },
  7: { cat: "social", verb: "reaccionó" },
  8: { cat: "otro", verb: "entregó un badge", hint: "Badges" },
  20: { cat: "foto", verb: "subió una foto", hint: "Olas" },
  21: { cat: "video", verb: "subió un video" },
  22: { cat: "video", verb: "subió un video corto" },
  1063: { cat: "foto", verb: "compartió un archivo" },
  1018: { cat: "social", verb: "votó en una encuesta" },
  1068: { cat: "social", verb: "creó una encuesta" },
  1111: { cat: "social", verb: "comentó" },
  1222: { cat: "social", verb: "mandó una nota de voz" },
  1311: { cat: "live", verb: "escribió en un chat en vivo", hint: "zap.stream" },
  1337: { cat: "dev", verb: "compartió código" },
  1617: { cat: "dev", verb: "mandó un patch", hint: "ngit" },
  9041: { cat: "zap", verb: "creó una meta de zaps" },
  9321: { cat: "zap", verb: "mandó un nutzap", hint: "Cashu" },
  9735: { cat: "zap", verb: "recibió un zap" },
  9802: { cat: "articulo", verb: "subrayó un texto", hint: "Highlighter" },
  30009: { cat: "otro", verb: "creó un badge", hint: "Badges" },
  30023: { cat: "articulo", verb: "publicó un artículo", hint: "Habla / YakiHonne" },
  30063: { cat: "ecosistema", verb: "publicó una versión de app", hint: "Zapstore" },
  // quiet: cuenta en burbujas y pulso, pero no va al feed (son cientos por minuto).
  30078: { cat: "otro", verb: "guardó datos de app", quiet: true },
  30311: { cat: "live", verb: "está transmitiendo en vivo", hint: "zap.stream" },
  30402: { cat: "mercado", verb: "publicó un clasificado", hint: "Shopstr / Plebeian" },
  30617: { cat: "dev", verb: "anunció un repo git", hint: "gitworkshop" },
  31922: { cat: "otro", verb: "creó un evento de calendario" },
  31923: { cat: "otro", verb: "creó un evento de calendario" },
  31337: { cat: "musica", verb: "subió un tema" },
  31989: { cat: "ecosistema", verb: "recomendó una app" },
  31990: { cat: "ecosistema", verb: "publicó una app 🆕" },
  32267: { cat: "ecosistema", verb: "publicó una app", hint: "Zapstore" },
  34235: { cat: "video", verb: "subió un video" },
  34550: { cat: "social", verb: "creó una comunidad" },
  36787: { cat: "musica", verb: "subió un tema", hint: "Wavlake" },
  39089: { cat: "social", verb: "armó un pack de seguidos", hint: "following.space" },
};

export function describeKind(kind) {
  if (KIND_MAP[kind]) return KIND_MAP[kind];
  if (kind >= 5000 && kind <= 5999) return { cat: "dvm", verb: "le pidió un trabajo a un DVM" };
  if (kind >= 6000 && kind <= 6999) return { cat: "dvm", verb: "respondió como DVM" };
  return { cat: "otro", verb: `publicó un kind ${kind}` };
}

// Kinds a los que nos suscribimos.
// Dejamos afuera 7 (reacciones) porque son demasiadas y tapan todo,
// y 30315 (estados de usuario): casi todos son "escuchando…" automáticos.
export const WATCHED_KINDS = [
  1, 6, 8, 20, 21, 22, 1018, 1063, 1068, 1111, 1222, 1311, 1337, 1617, 9041, 9321, 9735, 9802,
  30009, 30023, 30063, 30078, 30311, 30402, 30617, 31337, 31922, 31923, 31989, 31990, 32267,
  34235, 34550, 36787, 39089, 5000, 5001, 5002, 5050, 5100, 5300, 5302, 6050, 6100, 6300,
];
