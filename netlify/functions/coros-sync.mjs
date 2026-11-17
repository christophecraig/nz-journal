import { getStore } from "@netlify/blobs";
import { syncCoros } from "../lib/coros.mjs";

// Tâche planifiée : indépendante des visites du site.
// (Netlify n'exécute les fonctions planifiées que sur le déploiement de production publié.)
export const config = { schedule: "*/30 * * * *" };

export default async () => {
  const store = getStore({ name: "carnet", consistency: "strong" });
  try {
    const r = await syncCoros(store, { days: 14, maxNew: 3 });
    console.log(`Synchro Coros : ${r.seen} activités vues, ${r.added} ajoutées`);
  } catch (e) {
    if (e.code !== "not_connected") console.error("Synchro Coros :", e.message);
  }
};
