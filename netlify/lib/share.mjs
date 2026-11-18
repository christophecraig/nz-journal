// Aperçus de partage (Open Graph / Twitter Card) : fonctions pures, testables sans réseau.

export const SITE_NAME = "Carnet de bord NZ";
const DESC_MAX = 150;

export const escAttr = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Texte brut à partir du mini-Markdown du carnet, tronqué proprement (sans couper un mot ni un caractère). */
export function plainSnippet(src, max = DESC_MAX) {
  const t = String(src ?? "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*])\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(t);
  if (chars.length <= max) return t;
  const cut = chars.slice(0, max).join("");
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, "") + "…";
}

const fmtLongFr = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const s = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const isRealDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** Métadonnées de partage d'un jour, ou null si la fiche n'existe pas (→ aperçu générique). */
export function dayMeta(entry, origin) {
  if (!entry || !isRealDate(entry.date)) return null;
  const title = (entry.title || "").trim() || fmtLongFr(entry.date);
  const text = plainSnippet(entry.text);
  const photo = entry.photos?.[0];
  const imgKey = photo && (photo.thumb || photo.key);
  return {
    title: `${title} · ${SITE_NAME}`,
    description: text || `${fmtLongFr(entry.date)} · Carnet de bord de voyage en Nouvelle-Zélande`,
    url: `${origin}/jour/${entry.date}`,
    image: imgKey ? `${origin}/api/media/${encodeURIComponent(imgKey)}` : `${origin}/og-image.png`,
    photo: !!imgKey,
  };
}

/** Balises <meta> à insérer dans le <head>. Tout est échappé. */
export function metaTags(m) {
  const t = [
    ["property", "og:type", "article"],
    ["property", "og:site_name", SITE_NAME],
    ["property", "og:locale", "fr_FR"],
    ["property", "og:title", m.title],
    ["property", "og:description", m.description],
    ["property", "og:url", m.url],
    ["property", "og:image", m.image],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", m.title],
    ["name", "twitter:description", m.description],
    ["name", "twitter:image", m.image],
  ];
  return t.map(([k, n, v]) => `<meta ${k}="${n}" content="${escAttr(v)}">`).join("\n  ");
}

/** Insère le titre, la description et les balises de partage dans le HTML de l'accueil, sans toucher au reste. */
export function injectHead(html, m) {
  // Fonctions de remplacement : un « $& » ou « $1 » dans le texte du carnet ne doit pas être interprété.
  const out = html
    .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escAttr(m.title)}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/i, () => `<meta name="description" content="${escAttr(m.description)}">`)
    // balises de partage génériques de l'accueil : remplacées par celles du jour
    .replace(/\s*<meta\s+(?:property="og:|name="twitter:)[^>]*>/gi, "");
  return out.replace(/<\/head>/i, () => `  ${metaTags(m)}\n</head>`);
}
