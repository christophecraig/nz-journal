// Décide ce que le service worker fait d'une requête (pur, testable sous Node).
// Règle d'or : en cas de doute, "ignore" (la requête part au réseau comme si le service worker n'existait pas).

export const SHELL_PAGES = new Set(["/", "/confidentialite", "/conditions"]);
const STATIC_RE = /\.(?:js|css|svg|png|webmanifest)$/;
const MEDIA_RE = /^\/api\/media\/[a-f0-9-]{36}\.[a-z0-9]+$/;

/**
 * @param {{method:string,url:string,hasAuthorization:boolean,hasRange:boolean}} req
 * @param {string} origin origine du site (self.location.origin)
 * @returns {"ignore"|"media"|"data"|"shell"}
 *  - media : cache d'abord (clés UUID immuables)
 *  - data  : réseau d'abord, dernière réponse en secours hors ligne (entries / activities publiques)
 *  - shell : réseau d'abord, copie en secours hors ligne (pages, JS, CSS, icônes)
 */
export function pickStrategy(req, origin) {
  if (req.method !== "GET") return "ignore";
  if (req.hasAuthorization) return "ignore"; // admin, brouillons : jamais interceptés ni mis en cache
  if (req.hasRange) return "ignore"; // audio / seek : le Cache API gère mal les 206
  let u;
  try {
    u = new URL(req.url);
  } catch {
    return "ignore";
  }
  if (u.origin !== origin) return "ignore"; // Supabase, GoatCounter, tuiles OpenStreetMap, unpkg…
  if (u.search) return "ignore"; // retours OAuth (?code=…), ?coros=…, etc.
  const p = u.pathname;
  if (p === "/admin" || p.startsWith("/admin/") || p === "/admin.html") return "ignore";
  if (p === "/sw.js") return "ignore";
  if (MEDIA_RE.test(p)) return "media";
  if (p === "/api/entries" || p === "/api/activities") return "data";
  if (p.startsWith("/api/")) return "ignore"; // login, me, coros, geocode, comments…
  if (SHELL_PAGES.has(p) || /^\/jour\/\d{4}-\d{2}-\d{2}\/?$/.test(p)) return "shell";
  if (STATIC_RE.test(p)) return "shell";
  return "ignore"; // rss.xml, og-image… et tout ce qu'on ne connaît pas
}
