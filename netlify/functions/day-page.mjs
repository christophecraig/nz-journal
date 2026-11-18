import { getStore } from "@netlify/blobs";
import { dayMeta, injectHead, isRealDate } from "../lib/share.mjs";

// Sert /jour/AAAA-MM-JJ : le même index.html que l'accueil, avec les balises de partage du jour dans le <head>.
// Le front (History API) ne voit aucune différence : seul le <head> change.
export const config = { path: "/jour/*" };

// globalThis.__CARNET_STORE__ n'existe qu'en test local (store en mémoire).
const storeFactory = () => globalThis.__CARNET_STORE__ ?? getStore({ name: "carnet", consistency: "strong" });

const HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" };

export default async (req) => {
  const url = new URL(req.url);
  const date = url.pathname.replace(/^\/jour\//, "").replace(/\/$/, "");

  let html;
  try {
    const r = await fetch(`${url.origin}/`, { headers: { accept: "text/html" }, redirect: "follow" });
    if (!r.ok) throw new Error("accueil indisponible : " + r.status);
    html = await r.text();
  } catch (e) {
    console.error("Page de jour :", e.message);
    // Dernier recours : l'ancien format d'adresse, converti par le front.
    return Response.redirect(`${url.origin}/${isRealDate(date) ? "#" + date : ""}`, 302);
  }

  try {
    if (isRealDate(date)) {
      const entry = await storeFactory().get(`entries/${date}`, { type: "json" });
      const meta = dayMeta(entry, url.origin);
      if (meta) html = injectHead(html, meta); // jour inconnu : aperçu générique de l'accueil
    }
  } catch (e) {
    console.error("Aperçu du jour :", e.message); // on sert quand même la page
  }
  return new Response(html, { status: 200, headers: HEADERS });
};
