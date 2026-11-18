export const TOKEN_KEY = "carnet_token";
export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
};

export async function api(path, { method = "GET", body, headers = {} } = {}) {
  const h = { ...headers };
  const t = getToken();
  if (t) h.authorization = "Bearer " + t;
  let payload = body;
  if (body !== undefined && !(body instanceof Blob)) {
    payload = JSON.stringify(body);
    h["content-type"] = "application/json";
  }
  const r = await fetch("/api" + path, { method, headers: h, body: payload, cache: "no-store" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || "Erreur " + r.status);
    e.status = r.status;
    throw e;
  }
  return data;
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

/* Intégration vidéo */
export function videoEmbed(url) {
  let m;
  if ((m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url))) {
    return `<div class="embed"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  if ((m = /vimeo\.com\/(?:video\/)?(\d+)(?:\/([a-f0-9]+))?/.exec(url))) {
    const h = m[2] ? `?h=${m[2]}` : "";
    return `<div class="embed"><iframe src="https://player.vimeo.com/video/${m[1]}${h}" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) {
    return `<video controls playsinline preload="metadata" src="${esc(url)}"></video>`;
  }
  return `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Ouvrir la vidéo ↗</a>`;
}

export const osmLink = (lat, lng) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=14/${lat}/${lng}`;

/* Leaflet chargé à la demande */
let leafletPromise;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    js.onload = () => resolve(window.L);
    js.onerror = () => reject(new Error("Carte indisponible"));
    document.head.appendChild(js);
  });
  return leafletPromise;
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
