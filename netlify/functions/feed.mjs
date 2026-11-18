import { storeFactory, listPublishedEntries } from "../lib/store.mjs";
import { buildRss } from "../lib/feed.mjs";

// Flux RSS des jours écrits (brouillons exclus), du plus récent au plus ancien.
export const config = { path: "/rss.xml" };

export default async (req) => {
  const origin = new URL(req.url).origin;
  try {
    const entries = await listPublishedEntries(storeFactory());
    return new Response(buildRss(entries, origin), {
      status: 200,
      headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  } catch (e) {
    console.error("Flux RSS :", e.message);
    return new Response("Flux indisponible pour le moment", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "60" } });
  }
};
