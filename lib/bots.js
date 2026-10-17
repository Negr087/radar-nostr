// Detección de bots, en tres capas:
// 1. Por app (tag client): bots que lo dicen en el nombre, spam conocido y puentes.
// 2. Por perfil: NIP-24 permite marcar la cuenta con "bot": true.
// 3. Por ritmo: una cuenta con más de BOT_RATE notas en la ventana de 5 min.
// Una cuenta detectada por 2 o 3 queda marcada mientras dure la sesión.

import { normalizeName } from "./knownApps";

// Nombres normalizados (ver normalizeName).
const BLOCKED_CLIENTS = new Set([
  "mostr", // puente al fediverso: son posts de Mastodon, no uso de apps de Nostr
  "orignexus8", // red de cuentas que publica avisos de productos
]);

export const BOT_RATE = 20;

// Solo medimos el ritmo en notas: los eventos reemplazables (streams en vivo,
// fichas) se re-publican seguido, y los DVMs son automáticos a propósito.
export const RATE_KINDS = new Set([1, 6, 1111]);

export function isBotClient(name) {
  const n = normalizeName(name);
  return BLOCKED_CLIENTS.has(n) || n.endsWith("bot");
}

export function isBotProfile(meta) {
  return meta?.bot === true || meta?.bot === "true";
}
