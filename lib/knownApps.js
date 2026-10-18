// Known apps: many sign with just ["client", "Name"] and no 31990 address,
// so there is no app listing to get a logo/website from. This map covers the most used ones.
// The key is the normalized name (see normalizeName).
// `icon` is the icon each website declares, verified by hand (Oct 2026): many don't
// have it at /favicon.ico. Without `icon`, the website's favicon is tried.

export const KNOWN_APPS = {
  damus: { name: "Damus", website: "https://damus.io", icon: "https://damus.io/favicon.ico" },
  notedeck: { name: "Notedeck", website: "https://damus.io/notedeck", icon: "https://damus.io/favicon.ico" },
  amethyst: { name: "Amethyst", website: "https://amethyst.social", icon: "https://amethyst.social/amethyst-logo.jpg" },
  primal: { name: "Primal", website: "https://primal.net", icon: "https://primal.net/assets/apple-touch-icon-a536f430.png" },
  snort: { name: "Snort", website: "https://snort.social", icon: "https://snort.social/img/apple-touch-icon.png" },
  iris: { name: "Iris", website: "https://iris.to", icon: "https://iris.to/img/apple-touch-icon.png" },
  coracle: { name: "Coracle", website: "https://coracle.social", icon: "https://coracle.social/icons/apple-touch-icon-180x180.png" },
  flotilla: { name: "Flotilla", website: "https://flotilla.social", icon: "https://flotilla.social/apple-touch-icon.png" },
  nostrudel: { name: "noStrudel", website: "https://nostrudel.ninja", icon: "https://nostrudel.ninja/apple-touch-icon.png" },
  jumble: { name: "Jumble", website: "https://jumble.social", icon: "https://jumble.social/favicon.ico" },
  nos: { name: "Nos" }, // nos.social returns 404 today
  nostur: { name: "Nostur", website: "https://nostur.com", icon: "https://nostur.com/apple-touch-icon.png" },
  nostria: { name: "Nostria", website: "https://nostria.app", icon: "https://nostria.app/icons/icon-512x512-maskable.png" },
  yakihonne: { name: "YakiHonne", website: "https://yakihonne.com", icon: "https://yakihonne.com/favicon.ico" },
  habla: { name: "Habla", website: "https://habla.news" },
  hablanews: { name: "Habla", website: "https://habla.news" },
  highlighter: { name: "Highlighter", website: "https://highlighter.com", icon: "https://highlighter.com/apple-touch-icon-180x180.png" },
  olas: { name: "Olas", website: "https://olas.app", icon: "https://olas.app/favicon.png" },
  zapstream: { name: "zap.stream", website: "https://zap.stream", icon: "https://zap.stream/logo.png" },
  wavlake: { name: "Wavlake", website: "https://wavlake.com", icon: "https://wavlake.com/apple-touch-icon.png" },
  fountain: { name: "Fountain", website: "https://fountain.fm", icon: "https://fountain.fm/favicon.ico" },
  zapstore: { name: "Zapstore", website: "https://zapstore.dev", icon: "https://zapstore.dev/favicon.ico" },
  shopstr: { name: "Shopstr", website: "https://shopstr.store" },
  plebeianmarket: { name: "Plebeian Market", website: "https://plebeian.market", icon: "https://plebeian.market/logo-st5zpap9.svg" },
  nostter: { name: "nostter", website: "https://nostter.app", icon: "https://nostter.app/apple-touch-icon.png" },
  lumilumi: { name: "Lumilumi", website: "https://lumilumi.app", icon: "https://lumilumi.app/apple-touch-icon-180x180.png" },
  flycat: { name: "Flycat", website: "https://flycat.club" },
  satellite: { name: "Satellite", website: "https://satellite.earth", icon: "https://satellite.earth/apple-touch-icon.png" },
  chachi: { name: "Chachi", website: "https://chachi.chat" },
  ditto: { name: "Ditto", website: "https://ditto.pub", icon: "https://ditto.pub/apple-touch-icon.png" },
  stemstr: { name: "Stemstr", website: "https://stemstr.app" },
  pinstr: { name: "Pinstr" }, // pinstr.app now redirects to a casino: no link
  formstr: { name: "Formstr", website: "https://formstr.app", icon: "https://formstr.app/logo192.png" },
  listr: { name: "Listr", website: "https://listr.lol", icon: "https://listr.lol/apple-touch-icon.png" },
  nostree: { name: "Nostree", website: "https://nostree.me" },
  zapcooking: { name: "zap.cooking", website: "https://zap.cooking" },
  "0xchat": { name: "0xchat", website: "https://0xchat.com", icon: "https://0xchat.com/favi.png" },
  // The wisp.mobile favicon is just a dot: we use the app icon (official repo).
  wisp: { name: "Wisp", website: "https://wisp.mobile", icon: "https://raw.githubusercontent.com/barrydeen/wisp/main/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png" },
  // Fork of Wisp, no website of its own.
  darkwisp: { name: "Dark Wisp", website: "https://github.com/barrydeen/dark-wisp-android", icon: "https://raw.githubusercontent.com/barrydeen/dark-wisp-android/main/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png" },
  nostrich: { name: "Nostrich", website: "https://nostrich.org", icon: "https://nostrich.org/apple-touch-icon.png" },
  divine: { name: "diVine", website: "https://divine.video", icon: "https://divine.video/app_icon.png" },
  divinevideo: { name: "diVine", website: "https://divine.video", icon: "https://divine.video/app_icon.png" },
  // Lightning wallet; signs kind 30078 (encrypted Cashu mint list). zeusln.com's
  // apple-touch-icon/logo192 return HTML, so we use the app icon from the official repo.
  zeus: { name: "Zeus", website: "https://zeusln.com", icon: "https://raw.githubusercontent.com/ZeusLN/zeus/master/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png" },
  // Cashu ecash wallet; signs kind 30078 as "cashu.me".
  cashume: { name: "Cashu.me", website: "https://cashu.me", icon: "https://cashu.me/apple-icon.png" },
  // Android signer (NIP-55); no website, so we use the store icon from the official repo.
  amber: { name: "Amber", website: "https://github.com/greenart7c3/Amber", icon: "https://raw.githubusercontent.com/greenart7c3/Amber/master/fastlane/metadata/android/en-US/images/icon.png" },
  // Live streaming; signs its live chat messages (kind 1311) as "Shosho".
  shosho: { name: "Shosho", website: "https://shosho.live", icon: "https://shosho.live/apple-touch-icon.png" },
  // Discord-style NIP-29 groups. As of Oct 2026 it doesn't sign with a client tag and its
  // groups live on auth-only relays, so it only shows up here once it adds the tag.
  obelisk: { name: "Obelisk", website: "https://obelisk.ar", icon: "https://obelisk.ar/obelisk-favicon.png" },
};

// Words that don't change the app: "Primal Android" and "Primal Web" are the same bubble.
const NOISE = new Set(["android", "ios", "web", "desktop", "mobile", "app", "client", "beta", "alpha"]);
const VERSION = /^v?\d+(\.\d+)*([-+].*)?$/;

// "Amethyst 0.95.1" -> "amethyst", "noStrudel" -> "nostrudel", "zap.stream" -> "zapstream"
export function normalizeName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .split(/[\s/()]+/)
    .filter((w) => w && !VERSION.test(w) && !NOISE.has(w))
    .join("")
    .replace(/[^a-z0-9]/g, "");
}

// Bubble key from the name; null if the name can't identify an app.
export function appKeyFor(name) {
  const n = normalizeName(name);
  return n ? `app:${n}` : null;
}

// Only http(s) websites: the field comes from third-party metadata and ends up in an href.
export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export function faviconsFor(website) {
  if (!website) return [];
  const { origin } = new URL(website);
  return [`${origin}/apple-touch-icon.png`, `${origin}/favicon.ico`];
}
