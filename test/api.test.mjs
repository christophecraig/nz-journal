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
