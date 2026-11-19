export const TOKEN_KEY = "carnet_token";
export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
};

/** `auth: false` : requête anonyme même si ce navigateur est connecté en admin (la page publique voit ce que voit un visiteur). */
export async function api(path, { method = "GET", body, headers = {}, auth = true } = {}) {
  const h = { ...headers };
  const t = getToken();
  if (t && auth) h.authorization = "Bearer " + t;
  let payload = body;
  if (body !== undefined && !(body instanceof Blob)) {
    payload = JSON.stringify(body);
    h["content-type"] = "application/json";
  }
  // Requêtes publiques : le cache du navigateur et du CDN est permis (les en-têtes de la réponse décident).
  // Requêtes authentifiées (admin, brouillons) : jamais de cache.
  const r = await fetch("/api" + path, { method, headers: h, body: payload, cache: t && auth ? "no-store" : "default" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || "Erreur " + r.status);
    e.status = r.status;
    throw e;
  }
  return data;
}

/**
 * Réponse d'un préchargement lancé dans le <head> de la page publique (voir index.html), consommée une seule fois.
 * Renvoie le JSON, ou null si rien n'a été préchargé / si la requête a échoué : l'appelant refait alors un appel normal.
 */
export async function takePreloaded(name, win = globalThis.window) {
  const p = win?.__nzPre?.[name];
  if (!p) return null;
  delete win.__nzPre[name]; // une seule fois : les chargements suivants (après modification) doivent être frais
  try {
    return (await p) ?? null;
  } catch {
    return null;
  }
}

export const mediaUrl = (key) => "/api/media/" + encodeURIComponent(key);

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Mini-Markdown sûr : on échappe tout d'abord, puis on balise. */
export function md(src) {
  const lines = esc(src || "").split(/\r?\n/);
  const out = [];
  let list = false;
  let para = [];
  const inline = (t) =>
    t
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const flushP = () => {
    if (para.length) out.push("<p>" + inline(para.join("<br>")) + "</p>");
    para = [];
  };
  const closeList = () => {
    if (list) out.push("</ul>");
    list = false;
  };
  for (const line of lines) {
    let m;
    if (!line.trim()) { flushP(); closeList(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flushP(); closeList();
      const n = m[1].length + 2;
      out.push(`<h${n}>${inline(m[2])}</h${n}>`);
      continue;
    }
    if ((m = /^[-*]\s+(.*)$/.exec(line))) {
      flushP();
      if (!list) { out.push("<ul>"); list = true; }
      out.push("<li>" + inline(m[1]) + "</li>");
      continue;
    }
    if ((m = /^&gt;\s?(.*)$/.exec(line))) {
      flushP(); closeList();
      out.push("<blockquote>" + inline(m[1]) + "</blockquote>");
      continue;
    }
    closeList();
    para.push(line);
  }
  flushP(); closeList();
  return out.join("");
}

/* Dates (toujours locales, jamais via toISOString qui décale en UTC) */
const p2 = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const parseYmd = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const fmtLong = (s) =>
  cap(parseYmd(s).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
export const fmtMonth = (y, m) =>
  cap(new Date(y, m, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }));

/* Course à pied */
const p2n = (n) => String(n).padStart(2, "0");
export function fmtDur(sec) {
  const t = Math.round(sec);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${p2n(m)}:${p2n(s)}` : `${m}:${p2n(s)}`;
}
export const fmtPace = (sec) => { const t = Math.round(sec); return `${Math.floor(t / 60)}:${p2n(t % 60)}`; };
export const fmtKm = (km) => km.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
export const actLabel = (a) => (a.indoor ? "Course sur tapis" : a.kind === "trail" ? "Trail" : "Course à pied");
export const actTitle = (a) => (a.distanceKm ? `${actLabel(a)} · ${fmtKm(a.distanceKm)} km` : actLabel(a));

export const osmLink = (lat, lng) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=14/${lat}/${lng}`;

/* Leaflet chargé à la demande : d'abord depuis le site (copié au déploiement), sinon depuis unpkg en secours */
const LEAFLET_BASES = ["/vendor/leaflet/", "https://unpkg.com/leaflet@1.9.4/dist/"];
let leafletPromise;
function loadLeafletFrom(base) {
  return new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = base + "leaflet.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = base + "leaflet.js";
    js.onload = () => (window.L ? resolve(window.L) : reject(new Error("Leaflet absent")));
    js.onerror = () => {
      css.remove();
      js.remove();
      reject(new Error("Carte indisponible"));
    };
    document.head.appendChild(js);
  });
}
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletPromise ||= (async () => {
    let last;
    for (const base of LEAFLET_BASES) {
      try {
        return await loadLeafletFrom(base);
      } catch (e) {
        last = e;
      }
    }
    leafletPromise = null; // nouvel essai possible plus tard (réseau revenu)
    throw last || new Error("Carte indisponible");
  })();
  return leafletPromise;
}

/** Charge Leaflet et supabase-js pendant les temps morts, pour que carte et commentaires apparaissent sans attente. Sans effet en mode « économiser les données ». */
export function warmUp(...extra) {
  if (navigator.connection?.saveData) return;
  const run = () => {
    loadLeaflet().catch(() => {});
    for (const f of extra) Promise.resolve().then(f).catch(() => {});
  };
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}

export function addTiles(L, map) {
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
}

/** Jour demandé par l'adresse : /jour/AAAA-MM-JJ, ou l'ancien format #AAAA-MM-JJ. Chaîne vide s'il n'y en a pas. */
export function dayFromUrl(pathname, hash) {
  const m = /^\/jour\/(\d{4}-\d{2}-\d{2})\/?$/.exec(pathname || "");
  if (m) return m[1];
  const h = /^#(\d{4}-\d{2}-\d{2})$/.exec(hash || "");
  return h ? h[1] : "";
}

/** Adresse publique d'un jour. */
export const dayPath = (date) => `/jour/${date}`;
