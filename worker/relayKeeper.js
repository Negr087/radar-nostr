// Keeps the worker's relay connections alive. NDK (2.18) has two gaps for a 24/7 listener:
// - after a relay reconnects, the subscriptions that were running on it aren't sent again,
//   so it stays "connected" and silent;
// - it gives up on a relay after a few failed reconnects (or when it flaps, with a backoff
//   that doubles without limit), and then never retries.
// The worker restarts its live subscriptions after a reconnect (see worker/index.js) and
// calls revive() every minute on the relays NDK left behind.

// NDKRelayStatus values.
const DISCONNECTING = 0;
const DISCONNECTED = 1;
const FLAPPING = 3;
// WebSocket readyState values.
const WS_CONNECTING = 0;
const WS_OPEN = 1;

// Whether NDK has left this relay down with nothing scheduled to bring it back.
export function isAbandoned(relay) {
  const c = relay.connectivity;
  if (!c || c.reconnectTimeout) return false; // NDK has a retry scheduled
  const state = c.ws?.readyState;
  if (state === WS_CONNECTING || state === WS_OPEN) return false;
  return [DISCONNECTING, DISCONNECTED, FLAPPING].includes(relay.status);
}

// Reconnects the abandoned relays among `relays`; returns how many it tried.
export function revive(relays) {
  let tried = 0;
  for (const relay of relays) {
    if (!isAbandoned(relay)) continue;
    // connect() refuses to run from DISCONNECTING or FLAPPING: start over from DISCONNECTED.
    relay.connectivity._status = DISCONNECTED;
    relay.connect().catch(() => {});
    tried++;
  }
  return tried;
}
