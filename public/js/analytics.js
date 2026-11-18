import { CONFIG } from "./config.js";
import { getToken } from "./common.js";

// Statistiques GoatCounter (sans cookie). Désactivées sans code, sur /admin, et pour toi quand tu es connecté en admin.
let enabled = false;
let loaded = false;
const queue = [];

export function initAnalytics({ admin }) {
  if (!CONFIG.goatcounter || admin || getToken()) return;
  enabled = true;
  const s = document.createElement("script");
  s.async = true;
  s.dataset.goatcounter = `https://${CONFIG.goatcounter}.goatcounter.com/count`;
  s.dataset.goatcounterSettings = JSON.stringify({ no_onload: true }); // on compte nous-mêmes (une seule page côté navigateur)
  s.src = "//gc.zgo.at/count.js";
  s.onload = () => {
    loaded = true;
    for (const q of queue.splice(0)) window.goatcounter?.count?.(q);
  };
  document.head.appendChild(s);
}

/** Compte la consultation d'un jour (le site est une seule page : GoatCounter ne voit pas les changements de #date). */
export function track(path, title) {
  if (!enabled) return;
  const q = { path, title };
  if (loaded) window.goatcounter?.count?.(q);
  else queue.push(q);
}
