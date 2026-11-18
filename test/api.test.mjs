import test from "node:test";
import assert from "node:assert/strict";
import { memoryStore, loadApi } from "./helpers.mjs";

const store = memoryStore();
globalThis.__CARNET_STORE__ = store;
process.env.ADMIN_PASSWORD = "secret-pw";
const { default: handler, config } = await loadApi();
const call = (path, init = {}) => handler(new Request("https://site.test" + path, init));
const json = (r) => r.json();

let A;
const bytes = new Uint8Array(1000).map((_, i) => i % 256);

test("config de la fonction", () => assert.equal(config.path, "/api/*"));

test("login", async () => {
  assert.equal((await call("/api/login", { method: "POST", body: JSON.stringify({ password: "non" }) })).status, 401);
  const r = await call("/api/login", { method: "POST", body: JSON.stringify({ password: "secret-pw" }) });
  assert.equal(r.status, 200);
  A = { authorization: "Bearer " + (await json(r)).token };
  assert.equal((await call("/api/me")).status, 401);
  assert.equal((await call("/api/me", { headers: A })).status, 200);
  assert.equal((await call("/api/me", { headers: { authorization: "Bearer 9999999999999.xxxx" } })).status, 401);
});

test("médias : envoi, types, taille, Range", async () => {
  assert.equal((await call("/api/media", { method: "POST", headers: { "content-type": "image/jpeg" }, body: bytes })).status, 401);
  assert.equal((await call("/api/media", { method: "POST", headers: { ...A, "content-type": "video/mp4" }, body: bytes })).status, 415);
  assert.equal((await call("/api/media", { method: "POST", headers: { ...A, "content-type": "image/jpeg" }, body: new Uint8Array(6 * 1024 * 1024) })).status, 413);
  const r = await call("/api/media", { method: "POST", headers: { ...A, "content-type": "image/jpeg" }, body: bytes });
  const { key } = await json(r);
  const part = await call("/api/media/" + key, { headers: { range: "bytes=10-19" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 10-19/1000");
  assert.equal((await call("/api/media/" + key, { headers: { range: "bytes=5000-" } })).status, 416);
  assert.equal((await call("/api/media/../etc")).status, 404);
});

test("entrées : validation et nettoyage des médias orphelins", async () => {
  const up = async (type) => (await json(await call("/api/media", { method: "POST", headers: { ...A, "content-type": type }, body: bytes }))).key;
  const k1 = await up("image/jpeg");
  const k2 = await up("audio/webm;codecs=opus");
  const body = {
    title: "Jour 1", text: "Salut", photos: [{ key: k1 }, { key: "evil/../key" }], audios: [{ key: k2, label: "v" }],
    videos: [{ url: "javascript:alert(1)" }, { url: "https://youtu.be/abcdefghijk" }],
    places: [{ name: "Welly", lat: -41.28, lng: 174.77 }, { name: "bad", lat: 200, lng: 0 }],
  };
  assert.equal((await call("/api/entries/2026-11-20", { method: "PUT", body: "{}" })).status, 401);
  const r = await call("/api/entries/2026-11-20", { method: "PUT", headers: A, body: JSON.stringify(body) });
  const e = (await json(r)).entry;
  assert.deepEqual([e.photos.length, e.videos.length, e.places.length], [1, 1, 1]);
  assert.equal((await call("/api/entries/20-11-2026", { method: "PUT", headers: A, body: "{}" })).status, 400);
  await call("/api/entries/2026-11-20", { method: "PUT", headers: A, body: JSON.stringify({ ...body, audios: [] }) });
  assert.equal((await call("/api/media/" + k2)).status, 404);
  assert.equal((await call("/api/media/" + k1)).status, 200);
  assert.equal((await call("/api/entries/2026-11-20", { method: "DELETE", headers: A })).status, 200);
  assert.equal((await call("/api/media/" + k1)).status, 404);
  assert.equal((await json(await call("/api/entries"))).entries.length, 0);
});

test("activités : liste publique, indépendante des fiches", async () => {
  await store.setJSON("activities/1", { id: "1", date: "2026-11-18", startTs: 20, kind: "run", track: [] });
  await store.setJSON("activities/2", { id: "2", date: "2026-11-17", startTs: 10, kind: "trail", track: [[1, 2]] });
  const list = (await json(await call("/api/activities"))).activities;
  assert.deepEqual(list.map((a) => a.id), ["2", "1"]); // triées par heure de départ
  await call("/api/entries/2026-11-18", { method: "PUT", headers: A, body: JSON.stringify({ title: "x" }) });
  await call("/api/entries/2026-11-18", { method: "DELETE", headers: A });
  assert.equal((await json(await call("/api/activities"))).activities.length, 2); // intactes
});

test("routes Coros : accès protégé", async () => {
  for (const [m, p] of [["GET", "/api/coros/status"], ["POST", "/api/coros/connect"], ["POST", "/api/coros/sync"]]) {
    assert.equal((await call(p, { method: m })).status, 401, p);
  }
});

test("routes Coros : statut, synchro sans connexion, callback invalide", async () => {
  const st = await json(await call("/api/coros/status", { headers: A }));
  assert.equal(st.connected, false);
  assert.equal(st.activityCount, 2);
  const sync = await call("/api/coros/sync", { method: "POST", headers: A, body: "{}" });
  assert.equal(sync.status, 409);
  const cb = await call("/api/coros/callback?state=inconnu0000&code=x");
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get("location"), "https://site.test/admin?coros=error");
  const st2 = await json(await call("/api/coros/status", { headers: A }));
  assert.match(st2.lastError, /invalide|expirée/);
});

test("connexion Coros : l'URL de consentement part du bon domaine", async () => {
  globalThis.fetch = async (u, init) => {
    u = String(u);
    const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
    if (u.endsWith("oauth-authorization-server")) return j({ authorization_endpoint: "https://mcpeu.coros.com/oauth2/authorize", token_endpoint: "https://mcpeu.coros.com/oauth2/token", registration_endpoint: "https://mcpeu.coros.com/connect/register" });
    if (u.endsWith("/connect/register")) return j({ client_id: "c1" }, 201);
    throw new Error("inattendu " + u);
  };
  const { url } = await json(await call("/api/coros/connect", { method: "POST", headers: A }));
  const u = new URL(url);
  assert.equal(u.host, "mcpeu.coros.com");
  assert.equal(u.searchParams.get("redirect_uri"), "https://site.test/api/coros/callback");
});

/* ---------- Étapes, itinéraire, photos par étape ---------- */

const osrmOk = (calls) => async (u) => {
  u = String(u);
  calls.push(u);
  if (!u.includes("/route/v1/driving/")) throw new Error("inattendu " + u);
  return new Response(JSON.stringify({ code: "Ok", routes: [{ geometry: { coordinates: [[176.1654, -37.6878], [176.2, -37.9], [176.25, -38.1]] } }] }), { status: 200 });
};
const stops = [
  { id: "a1", name: "Tauranga", lat: -37.6878, lng: 176.1654, time: "09:15", note: "Départ" },
  { id: "a2", name: "Mount Maunganui", lat: -37.6329, lng: 176.1818 },
  { id: "a3", name: "Maison", lat: -40.123456, lng: 175.987654, approx: true },
];

test("étapes : champs conservés, ordre gardé, itinéraire calculé une seule fois", async () => {
  const calls = [];
  globalThis.fetch = osrmOk(calls);
  const put = (body) => call("/api/entries/2026-11-15", { method: "PUT", headers: A, body: JSON.stringify(body) });
  const e = (await json(await put({ title: "Dimanche", places: stops, routeMode: "drive" }))).entry;
  assert.deepEqual(e.places.map((p) => p.id), ["a1", "a2", "a3"]);
  assert.equal(e.places[0].time, "09:15");
  assert.equal(e.places[0].note, "Départ");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /176\.16540,-37\.68780;176\.18180,-37\.63290;175\.99000,-40\.12000/); // la position approximative est arrondie AVANT le calcul
  assert.equal(e.route.points.length, 3);
  assert.deepEqual(e.route.points[0], [-37.6878, 176.1654]); // stocké en [lat, lng]
  // 2e sauvegarde avec les mêmes étapes (autre titre) : pas de nouvel appel
  const e2 = (await json(await put({ title: "Dimanche bis", places: e.places, routeMode: "drive" }))).entry;
  assert.equal(calls.length, 1);
  assert.deepEqual(e2.route, e.route);
  // une étape déplacée : nouvel appel
  const moved = e.places.map((p, i) => (i === 1 ? { ...p, lat: -37.7 } : p));
  await put({ places: moved });
  assert.equal(calls.length, 2);
});

test("étapes : position approximative arrondie côté serveur (le précis n'est jamais stocké)", async () => {
  const list = (await json(await call("/api/entries"))).entries.find((x) => x.date === "2026-11-15");
  const home = list.places.find((p) => p.id === "a3");
  assert.deepEqual([home.lat, home.lng, home.approx], [-40.12, 175.99, true]);
  assert.ok(!JSON.stringify(list).includes("40.1234"));
});

test("étapes : routeMode none, une seule étape, service OSRM en panne (repli sans erreur)", async () => {
  const calls = [];
  globalThis.fetch = osrmOk(calls);
  const put = (body) => call("/api/entries/2026-11-16", { method: "PUT", headers: A, body: JSON.stringify(body) });
  let e = (await json(await put({ places: stops, routeMode: "none" }))).entry;
  assert.equal(e.route, undefined);
  e = (await json(await put({ places: [stops[0]] }))).entry;
  assert.equal(e.route, undefined);
  assert.equal(calls.length, 0);
  for (const failing of [async () => new Response("boom", { status: 503 }), async () => { throw new Error("réseau"); }, async () => new Response(JSON.stringify({ code: "NoRoute" }))]) {
    globalThis.fetch = failing;
    const r = await put({ places: stops });
    assert.equal(r.status, 200);
    assert.equal((await json(r)).entry.route, undefined);
  }
});

test("photos : rattachées à une étape existante uniquement ; supprimer l'étape détache", async () => {
  globalThis.fetch = osrmOk([]);
  const up = async () => (await json(await call("/api/media", { method: "POST", headers: { ...A, "content-type": "image/jpeg" }, body: bytes }))).key;
  const [k1, k2, k3] = [await up(), await up(), await up()];
  const put = (body) => call("/api/entries/2026-11-17", { method: "PUT", headers: A, body: JSON.stringify(body) });
  const photos = [{ key: k1, placeId: "a2" }, { key: k2, placeId: "inconnue" }, { key: k3 }];
  const e = (await json(await put({ places: stops, photos }))).entry;
  assert.deepEqual(e.photos.map((p) => p.placeId), ["a2", undefined, undefined]);
  const e2 = (await json(await put({ places: stops.filter((p) => p.id !== "a2"), photos: e.photos }))).entry;
  assert.deepEqual(e2.photos.map((p) => p.placeId), [undefined, undefined, undefined]);
  assert.equal(e2.photos.length, 3); // aucune photo perdue
});

test("anciennes fiches : lieux sans id/heure toujours valides, rien de perdu", async () => {
  globalThis.fetch = osrmOk([]);
  // fiche telle qu'enregistrée avant cette fonctionnalité
  await store.setJSON("entries/2026-11-10", { date: "2026-11-10", title: "Ancien", text: "t", photos: [], audios: [], videos: [], places: [{ name: "Welly", lat: -41.28, lng: 174.77 }], updatedAt: "x" });
  const old = (await json(await call("/api/entries"))).entries.find((x) => x.date === "2026-11-10");
  assert.equal(old.places[0].name, "Welly"); // lecture inchangée
  // le front renvoie la fiche telle quelle : elle gagne un id, garde ses données
  const e = (await json(await call("/api/entries/2026-11-10", { method: "PUT", headers: A, body: JSON.stringify(old) }))).entry;
  assert.equal(e.title, "Ancien");
  assert.equal(e.places.length, 1);
  assert.match(e.places[0].id, /^[a-z0-9-]{8}$/);
  assert.deepEqual([e.places[0].lat, e.places[0].lng], [-41.28, 174.77]);
  assert.equal(e.route, undefined); // 1 seule étape
});

test("étapes : validations (heure, id dupliqué, coordonnées)", async () => {
  globalThis.fetch = osrmOk([]);
  const r = await call("/api/entries/2026-11-18", {
    method: "PUT", headers: A,
    body: JSON.stringify({ routeMode: "none", places: [
      { id: "x", name: "A", lat: 1, lng: 2, time: "25:99" },
      { id: "x", name: "B", lat: 3, lng: 4, time: "08:05" },
      { name: "C", lat: 95, lng: 0 },
      { name: "D", lat: "1", lng: 0 },
    ] }),
  });
  const p = (await json(r)).entry.places;
  assert.equal(p.length, 2);
  assert.equal(p[0].time, undefined);
  assert.equal(p[1].time, "08:05");
  assert.notEqual(p[0].id, p[1].id);
});

/* ---------- Recherche de lieux ---------- */

test("géocodage : réservé à l'admin", async () => {
  assert.equal((await call("/api/geocode?q=Taupo")).status, 401);
  assert.equal((await call("/api/geocode?reverse=1&lat=1&lon=2")).status, 401);
});

test("géocodage : Photon (biais de position, normalisation, cache) puis Nominatim sur demande", async () => {
  const urls = [];
  globalThis.fetch = async (u, init) => {
    u = new URL(String(u));
    urls.push(u.href);
    assert.match(init.headers["user-agent"], /nz-journal/); // identifiant d'application exigé par les règles d'usage
    if (u.host === "photon.komoot.io" && u.pathname === "/api/") {
      return new Response(JSON.stringify({ features: [
        { geometry: { coordinates: [176.0702, -38.6857] }, properties: { name: "Taupō", city: "Taupō", state: "Waikato", country: "New Zealand" } },
        { geometry: { coordinates: [176.18, -37.63] }, properties: { name: "Café Mount", street: "Maunganui Road", housenumber: "12", district: "Mount Maunganui", city: "Tauranga", country: "New Zealand" } },
        { geometry: { coordinates: [999, 0] }, properties: { name: "Cassé" } }, // coordonnées invalides : ignoré
        { geometry: { coordinates: [1, 2] }, properties: {} }, // sans nom : ignoré
      ] }));
    }
    if (u.host === "photon.komoot.io" && u.pathname === "/reverse") {
      return new Response(JSON.stringify({ features: [{ geometry: { coordinates: [175.9, -40.1] }, properties: { name: "Pariatua", state: "Wellington" } }] }));
    }
    if (u.host === "nominatim.openstreetmap.org" && u.pathname === "/search") {
      return new Response(JSON.stringify([{ name: "Huka Falls", display_name: "Huka Falls, Taupō, Waikato, New Zealand", lat: "-38.6489", lon: "176.0903" }]));
    }
    throw new Error("inattendu " + u);
  };
  const get = async (qs) => json(await call("/api/geocode?" + qs, { headers: A }));
  const r = await get("q=Taupo&lat=-37.7&lon=176.1");
  assert.equal(r.mode, "photon");
  assert.equal(r.results.length, 2);
  assert.deepEqual(r.results[0], { name: "Taupō", detail: "Waikato, New Zealand", lat: -38.6857, lng: 176.0702 });
  assert.equal(r.results[1].detail, "12 Maunganui Road, Mount Maunganui, Tauranga, New Zealand");
  const ph = new URL(urls[0]);
  assert.equal(ph.searchParams.get("lat"), "-37.7");
  assert.equal(ph.searchParams.get("lon"), "176.1");
  await get("q=Taupo&lat=-37.7&lon=176.1"); // 2e appel identique : servi par le cache
  assert.equal(urls.length, 1);
  assert.deepEqual((await get("q=a")).results, []); // trop court : aucun appel externe
  assert.equal(urls.length, 1);
  const n = await get("q=Huka&mode=nominatim");
  assert.equal(n.mode, "nominatim");
  assert.deepEqual(n.results[0], { name: "Huka Falls", detail: "Taupō, Waikato, New Zealand", lat: -38.6489, lng: 176.0903 });
  const rev = await get("reverse=1&lat=-40.1&lon=175.9");
  assert.equal(rev.place.name, "Pariatua");
});

test("géocodage : service en panne -> erreur propre ; géocodage inverse -> null", async () => {
  globalThis.fetch = async () => new Response("boom", { status: 503 });
  const r = await call("/api/geocode?q=Rotorua", { headers: A });
  assert.equal(r.status, 502);
  assert.match((await json(r)).error, /indisponible/);
  globalThis.fetch = async () => { throw new Error("réseau"); };
  const rev = await json(await call("/api/geocode?reverse=1&lat=-40&lon=175", { headers: A }));
  assert.equal(rev.place, null);
  assert.equal((await json(await call("/api/geocode?reverse=1&lat=abc&lon=175", { headers: A }))).place, null);
});

/* ---------- Modération des commentaires ---------- */

test("commentaires : suppression réservée à l'admin, clé secrète côté serveur", async () => {
  const id = "3f2b8f0e-1c4d-4e5a-9b6c-7d8e9f0a1b2c";
  assert.equal((await call(`/api/comments/${id}`, { method: "DELETE" })).status, 401);
  assert.equal((await call("/api/comments/pas-un-uuid", { method: "DELETE", headers: A })).status, 400);
  assert.equal((await call(`/api/comments/${id}`, { method: "DELETE", headers: A })).status, 503); // variables absentes
  process.env.SUPABASE_URL = "https://abc.supabase.co/";
  process.env.SUPABASE_SERVICE_KEY = "service-secret";
  let seen;
  globalThis.fetch = async (u, init) => { seen = { u: String(u), init }; return new Response(JSON.stringify([{ id }]), { status: 200 }); };
  const r = await call(`/api/comments/${id}`, { method: "DELETE", headers: A });
  assert.equal(r.status, 200);
  assert.deepEqual(await json(r), { deleted: 1 });
  assert.equal(seen.u, `https://abc.supabase.co/rest/v1/comments?id=eq.${id}`);
  assert.equal(seen.init.method, "DELETE");
  assert.equal(seen.init.headers.authorization, "Bearer service-secret");
  globalThis.fetch = async () => new Response("boom", { status: 500 });
  const bad = await call(`/api/comments/${id}`, { method: "DELETE", headers: A });
  assert.equal(bad.status, 502);
  assert.ok(!(await bad.text()).includes("service-secret"));
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});
