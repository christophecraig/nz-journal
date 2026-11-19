// Service worker prudent : jamais de version périmée tant que le réseau répond (voir issue #16).
//  - pages, JS, CSS : réseau d'abord, copie en secours seulement si le réseau échoue ou dépasse le délai
//  - données publiques (entries / activities) : idem, jamais de stale-while-revalidate ici (la vitesse vient du CDN)
//  - photos : cache d'abord (clés UUID immuables), plafonné
//  - tout le reste (admin, Authorization, Range, POST, tiers…) : ignoré
// Interrupteur de secours : voir README, section « Service worker ».
import { pickStrategy } from "/js/sw-strategy.js";

const VERSION = "v1"; // à changer seulement si le FORMAT de ce qu'on met en cache change (les anciens caches sont supprimés)
const SHELL = `nzj-shell-${VERSION}`;
const DATA = `nzj-data-${VERSION}`;
const MEDIA = `nzj-media-${VERSION}`;
const KEEP = new Set([SHELL, DATA, MEDIA]);
const NETWORK_TIMEOUT_MS = 3000;
const MEDIA_MAX_ENTRIES = 200;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (!KEEP.has(name)) await caches.delete(name);
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const strategy = pickStrategy(
    { method: request.method, url: request.url, hasAuthorization: request.headers.has("authorization"), hasRange: request.headers.has("range") },
    self.location.origin
  );
  if (strategy === "ignore") return; // pas de respondWith : le navigateur fait comme sans service worker
  if (strategy === "media") event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request, strategy === "data" ? DATA : SHELL));
});

const cacheable = (res) => res.status === 200 && res.type === "basic";

async function put(cacheName, key, res) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(key, res);
  } catch {
    /* quota ou stockage indisponible : on s'en passe */
  }
}

async function networkFirst(request, cacheName) {
  const key = new URL(request.url).pathname;
  const cached = async () => {
    try {
      const cache = await caches.open(cacheName);
      return (await cache.match(key)) || (request.mode === "navigate" ? await cache.match("/") : undefined);
    } catch {
      return undefined;
    }
  };
  // Pas de surcharge de `cache` : le serveur répond déjà `max-age=0, must-revalidate` (Netlify pour les fichiers statiques, api.mjs pour les données),
  // donc le navigateur revalide toujours ; et on ne perturbe pas le cache du CDN (#12).
  const network = fetch(request).then(async (res) => {
    if (res.status >= 500) {
      const old = await cached();
      if (old) return old; // erreur serveur : mieux vaut la dernière bonne copie
      return res;
    }
    if (cacheable(res)) put(cacheName, key, res.clone()); // sans attendre : ne ralentit pas la réponse
    return res;
  });
  // Réseau lent : si on a une copie, on la sert au bout du délai ; sinon on continue d'attendre le réseau.
  let timer;
  const slow = new Promise((resolve) => {
    timer = setTimeout(async () => resolve(await cached()), NETWORK_TIMEOUT_MS);
  });
  try {
    const first = await Promise.race([network, slow]);
    return first || (await network);
  } catch {
    const old = await cached();
    if (old) return old;
    return Response.error();
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(request) {
  const key = new URL(request.url).pathname;
  try {
    const cache = await caches.open(MEDIA);
    const hit = await cache.match(key);
    if (hit) return hit;
  } catch {
    /* on passe au réseau */
  }
  const res = await fetch(request);
  if (cacheable(res)) {
    put(MEDIA, key, res.clone()).then(trimMedia);
  }
  return res;
}

async function trimMedia() {
  try {
    const cache = await caches.open(MEDIA);
    const keys = await cache.keys(); // ordre d'insertion : les plus anciennes d'abord
    for (const k of keys.slice(0, Math.max(0, keys.length - MEDIA_MAX_ENTRIES))) await cache.delete(k);
  } catch {
    /* sans importance */
  }
}
