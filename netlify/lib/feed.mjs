// Flux RSS 2.0 du carnet : fonctions pures, testables sans réseau.
import { SITE_NAME, plainSnippet, isRealDate } from "./share.mjs";

const MAX_ITEMS = 30;

// Caractères interdits en XML 1.0 (contrôles) : on les retire plutôt que de produire un flux invalide.
const XML_BAD = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;
export const xmlEsc = (s) =>
  String(s ?? "")
    .replace(XML_BAD, "")
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

const rfc822 = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toUTCString();
};

/** Un jour est « écrit » s'il a un titre ou un récit (les jours qui n'ont que des courses Coros n'ont pas de fiche, donc pas d'élément). */
export const isWritten = (e) => !!e && !e.draft && isRealDate(e.date) && !!((e.title || "").trim() || (e.text || "").trim());

export function buildRss(entries, origin) {
  const written = entries.filter(isWritten).sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_ITEMS);
  const last = written.reduce((m, e) => (e.updatedAt && e.updatedAt > m ? e.updatedAt : m), "");
  const items = written.map((e) => {
    const link = `${origin}/jour/${e.date}`;
    const photo = e.photos?.[0];
    const img = photo ? `${origin}/api/media/${encodeURIComponent(photo.thumb || photo.key)}` : "";
    const snippet = plainSnippet(e.text, 300);
    // description = HTML (échappé comme l'exige RSS) : photo puis début du récit
    const html = `${img ? `<p><img src="${img.replace(/"/g, "%22")}" alt=""></p>` : ""}${snippet ? `<p>${snippet.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</p>` : ""}`;
    return `    <item>
      <title>${xmlEsc((e.title || "").trim() || `Jour du ${e.date}`)}</title>
      <link>${xmlEsc(link)}</link>
      <guid isPermaLink="true">${xmlEsc(link)}</guid>
      <pubDate>${rfc822(e.date)}</pubDate>
      <description>${xmlEsc(html)}</description>
    </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEsc(SITE_NAME)} · Nouvelle-Zélande</title>
    <link>${xmlEsc(origin)}/</link>
    <description>Carnet de bord de voyage en Nouvelle-Zélande : un jour, une page.</description>
    <language>fr</language>
    <atom:link href="${xmlEsc(origin)}/rss.xml" rel="self" type="application/rss+xml"/>${last ? `\n    <lastBuildDate>${new Date(last).toUTCString()}</lastBuildDate>` : ""}
${items.join("\n")}
  </channel>
</rss>
`;
}
