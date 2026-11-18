import { getStore } from "@netlify/blobs";

// globalThis.__CARNET_STORE__ n'existe qu'en test local (store en mémoire).
export const storeFactory = () => globalThis.__CARNET_STORE__ ?? getStore({ name: "carnet", consistency: "strong" });

/** Fiches publiées (hors brouillons), de la plus ancienne à la plus récente. */
export async function listPublishedEntries(s) {
  const { blobs } = await s.list({ prefix: "entries/" });
  const all = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return all.filter((e) => e && !e.draft).sort((a, b) => a.date.localeCompare(b.date));
}
