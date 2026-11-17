import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  parseRecords, parseDetail, extractFitUrl, parseRpcResponse, unwrapText,
  startAuth, completeAuth, syncCoros, listActivities, corosStatus, McpClient,
} from "../netlify/lib/coros.mjs";
import { memoryStore, buildFit } from "./helpers.mjs";

// Texte au même format que les réponses réelles de Coros (valeurs fictives).
const RECORDS = (extra = "") => `Sport Records — 2026-11-10 to 2026-11-19 (3 records)
========================

1. Trail Run — 2026-11-18
   Location: Sentier Test
   Start Coordinates: -41.100000, 175.100000
   Time Window: startTimestamp=1794951973 | endTimestamp=1794954308
   Duration: 38:55 | Distance: 6.67 km
   Average Pace: 5:50 /km | Avg HR: 140 bpm | Calories: 382 kcal
   LabelId: 111111111111111111 | SportType: 102

2. Outdoor Run — 2026-11-16
   Duration: 1:02:03 | Distance: 10.00 km
   Average Pace: 6:12 /km
   LabelId: 222222222222222222 | SportType: 100

3. Outdoor Run — 2026-11-01
   Duration: 30:00 | Distance: 5.00 km
   LabelId: 333333333333333333 | SportType: 100
${extra}`;
const DETAIL = `🏃 Trail Run Activity Details
Average Cadence: 169 spm
Elevation Gain / Loss: 36 m / 38 m
Calories: 382 kcal`;

test("parseRecords lit les enregistrements", () => {
  const r = parseRecords(RECORDS());
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], {
    id: "111111111111111111", date: "2026-11-18", sportType: 102, startTs: 1794951973,
    location: "Sentier Test", start: { lat: -41.1, lng: 175.1 }, durationSec: 2335, distanceKm: 6.67,
    paceSecPerKm: 350, avgHr: 140, calories: 382,
  });
  assert.equal(r[1].durationSec, 3723);
  assert.equal(r[1].start, null);
  assert.equal(r[1].avgHr, null);
  assert.equal(r[2].paceSecPerKm, 360); // calculée : 1800 s / 5 km
});

test("parseRecords tolère la casse et « = » à la place de « : »", () => {
  const r = parseRecords("Sport Records\n\n1. Trail Run — 2026-11-18\n   Duration: 10:00 | Distance: 2.00 km\n   labelId=5551 | sportType=102\n");
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].id, r[0].sportType, r[0].paceSecPerKm], ["5551", 102, 300]);
});

test("parseRecords : aucun enregistrement", () => {
  assert.deepEqual(parseRecords("No sport records found."), []);
});

test("parseDetail et extractFitUrl", () => {
  assert.deepEqual(parseDetail(DETAIL), { elevGain: 36, elevLoss: 38, cadence: 169 });
  assert.deepEqual(parseDetail("rien"), { elevGain: null, elevLoss: null, cadence: null });
  assert.equal(extractFitUrl("Activity FIT file download URL(s):\n1. a.fit\n   https://s3eu.coros.com/fit/v2/1/a_b.fit\n"), "https://s3eu.coros.com/fit/v2/1/a_b.fit");
  assert.equal(extractFitUrl("aucune url"), null);
});

test("parseRpcResponse : JSON, SSE, erreur", () => {
  assert.deepEqual(parseRpcResponse('{"jsonrpc":"2.0","id":3,"result":{"a":1}}', "application/json", 3), { a: 1 });
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/x"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":5,"result":{"ok":true}}\n\n';
  assert.deepEqual(parseRpcResponse(sse, "text/event-stream", 5), { ok: true });
  assert.throws(() => parseRpcResponse('{"jsonrpc":"2.0","id":1,"error":{"message":"boom"}}', "application/json", 1), /boom/);
  assert.throws(() => parseRpcResponse('{"jsonrpc":"2.0","id":9,"result":{}}', "application/json", 1));
});

/* ---- Faux serveur Coros (OAuth + MCP + stockage FIT) ---- */

function fakeCoros({ sse = false, quoted = false, rejectFirstMcp = false, records = RECORDS(), fitOk = true } = {}) {
  const log = { tokenBodies: [], mcpCalls: [], authHeaders: [], registrations: [] };
  let mcpRejected = false;
  const fit = buildFit([[-41.1, 175.1], [-41.101, 175.102], [-41.102, 175.104]]);
  const json = (obj, status = 200, headers = {}) =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
  const fetchFn = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/.well-known/oauth-authorization-server")) {
      return json({
        issuer: "https://mcpeu.coros.com",
        authorization_endpoint: "https://mcpeu.coros.com/oauth2/authorize",
        token_endpoint: "https://mcpeu.coros.com/oauth2/token",
        registration_endpoint: "https://mcpeu.coros.com/connect/register",
      });
    }
    if (url.endsWith("/connect/register")) {
      log.registrations.push(JSON.parse(init.body));
      return json({ client_id: "client-abc" }, 201);
    }
    if (url.endsWith("/oauth2/token")) {
      const body = new URLSearchParams(init.body);
      log.tokenBodies.push(Object.fromEntries(body));
      if (body.get("grant_type") === "refresh_token" && body.get("refresh_token") === "REVOKED") return json({ error: "invalid_grant" }, 400);
      const n = log.tokenBodies.length;
      return json({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600 });
    }
    if (url.endsWith("/mcp")) {
      log.authHeaders.push(init.headers.authorization);
      if (rejectFirstMcp && !mcpRejected) { mcpRejected = true; return new Response("", { status: 401 }); }
      const msg = JSON.parse(init.body);
      const reply = (result) => {
        const body = { jsonrpc: "2.0", id: msg.id, result };
        return sse
          ? new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-1" } })
          : json(body, 200, { "mcp-session-id": "sess-1" });
      };
      if (msg.method === "initialize") return reply({ protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "coros" } });
      if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (msg.method === "tools/call") {
        log.mcpCalls.push({ name: msg.params.name, args: msg.params.arguments, session: init.headers["mcp-session-id"] });
        // `quoted` : comme le vrai serveur Coros, le texte est une chaîne JSON entre guillemets
        const t = (text) => reply({ content: [{ type: "text", text: quoted ? JSON.stringify(text) : text }] });
        if (msg.params.name === "querySportRecords") return t(records);
        if (msg.params.name === "getActivityDetail") return t(DETAIL);
        if (msg.params.name === "queryActivityFitFileDownloadUrls") return t("Activity FIT file download URL(s):\n1. x.fit\n   https://s3eu.coros.com/fit/v2/1/x.fit");
      }
      return json({ jsonrpc: "2.0", id: msg.id, error: { message: "inconnu" } });
    }
    if (url.endsWith("/x.fit")) return fitOk ? new Response(fit) : new Response("", { status: 403 });
    throw new Error("URL non prévue par le test : " + url);
  };
  return { fetchFn, log };
}

async function connected(opts) {
  const store = memoryStore();
  const fake = fakeCoros(opts);
  globalThis.fetch = fake.fetchFn;
  const authUrl = new URL(await startAuth(store, "https://site.test"));
  await completeAuth(store, new URLSearchParams({ state: authUrl.searchParams.get("state"), code: "CODE" }));
  return { store, fake, authUrl };
}

const NOW = new Date("2026-11-18T23:00:00Z");

test("startAuth : PKCE S256, enregistrement du client et état à usage unique", async () => {
  const { store, fake, authUrl } = await connected();
  const p = authUrl.searchParams;
  assert.equal(authUrl.origin + authUrl.pathname, "https://mcpeu.coros.com/oauth2/authorize");
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("client_id"), "client-abc");
  assert.equal(p.get("redirect_uri"), "https://site.test/api/coros/callback");
  assert.equal(p.get("code_challenge_method"), "S256");
  assert.match(p.get("scope"), /offline_access/);
  assert.equal(fake.log.registrations[0].token_endpoint_auth_method, "none");
  // le code_verifier envoyé correspond au challenge
  const verifier = fake.log.tokenBodies[0].code_verifier;
  assert.equal(createHash("sha256").update(verifier).digest("base64url"), p.get("code_challenge"));
  assert.equal(fake.log.tokenBodies[0].redirect_uri, "https://site.test/api/coros/callback");
  // l'état est consommé : rejouer le callback échoue
  await assert.rejects(completeAuth(store, new URLSearchParams({ state: p.get("state"), code: "CODE" })), /expirée|déjà utilisée/);
  await assert.rejects(completeAuth(store, new URLSearchParams({ state: "x", code: "c" })), /state invalide/);
  assert.equal((await corosStatus(store)).connected, true);
});

test("completeAuth : refus de l'utilisateur", async () => {
  const store = memoryStore();
  globalThis.fetch = fakeCoros().fetchFn;
  const u = new URL(await startAuth(store, "https://site.test"));
  await assert.rejects(completeAuth(store, new URLSearchParams({ state: u.searchParams.get("state"), error: "access_denied" })), /refusé/);
  assert.equal((await corosStatus(store)).connected, false);
});

test("syncCoros : ajoute les courses (récentes, au-dessus du plancher), avec détail et tracé", async () => {
  const { store, fake } = await connected();
  const r = await syncCoros(store, { now: NOW });
  assert.equal(r.seen, 3);
  assert.equal(r.added, 2); // celle du 1er novembre est avant le plancher (15 novembre)
  const acts = await listActivities(store);
  assert.equal(acts.length, 2);
  const trail = acts.find((a) => a.id === "111111111111111111");
  assert.equal(trail.kind, "trail");
  assert.equal(trail.date, "2026-11-18");
  assert.equal(trail.elevGain, 36);
  assert.equal(trail.cadence, 169);
  assert.equal(trail.track.length, 3);
  assert.deepEqual(trail.warnings, []);
  // requête MCP : types de course uniquement, session réutilisée, jeton Bearer
  const q = fake.log.mcpCalls.find((c) => c.name === "querySportRecords");
  assert.deepEqual(q.args.sportTypeCodes, [100, 101, 102, 103]);
  assert.equal(q.args.startDate, "20261115");
  // tous les paramètres obligatoires de querySportRecords sont fournis (0 / "" = filtre désactivé)
  assert.deepEqual(
    { ...q.args, sportTypeCodes: undefined },
    { startDate: "20261115", endDate: "", sportTypeCodes: undefined, minDistanceKm: 0, maxDistanceKm: 0, minDurationMinutes: 0, maxDurationMinutes: 0, maxAveragePace: "", locationKeyword: "", limit: 50 },
  );
  assert.equal(q.session, "sess-1");
  assert.ok(fake.log.authHeaders.every((h) => h === "Bearer access-1"));
  const status = await corosStatus(store);
  assert.equal(status.lastAdded, 2);
  assert.equal(status.lastError, null);
  assert.equal(status.activityCount, 2);
});

test("syncCoros est idempotent et respecte maxNew", async () => {
  const { store } = await connected();
  assert.equal((await syncCoros(store, { now: NOW, maxNew: 1 })).added, 1);
  assert.equal((await syncCoros(store, { now: NOW, maxNew: 5 })).added, 1);
  assert.equal((await syncCoros(store, { now: NOW })).added, 0);
  assert.equal((await listActivities(store)).length, 2);
});

test("unwrapText décode une chaîne JSON et laisse le texte brut intact", () => {
  assert.equal(unwrapText(JSON.stringify("a\nb \"c\"")), 'a\nb "c"');
  assert.equal(unwrapText("texte normal"), "texte normal");
  assert.equal(unwrapText('"pas du json'), '"pas du json');
  assert.equal(unwrapText('"un" et "deux"'), '"un" et "deux"');
});

test("syncCoros fonctionne quand Coros renvoie son texte sous forme de chaîne JSON", async () => {
  const { store } = await connected({ quoted: true });
  const r = await syncCoros(store, { now: NOW });
  assert.equal(r.added, 2);
  const trail = (await listActivities(store)).find((a) => a.id === "111111111111111111");
  assert.equal(trail.distanceKm, 6.67);
  assert.equal(trail.elevGain, 36);
  assert.equal(trail.track.length, 3);
  assert.deepEqual(trail.warnings, []);
});

test("syncCoros fonctionne avec des réponses SSE", async () => {
  const { store } = await connected({ sse: true });
  assert.equal((await syncCoros(store, { now: NOW })).added, 2);
});

test("un échec du tracé n'empêche pas d'enregistrer la course (avertissement)", async () => {
  const { store } = await connected({ fitOk: false });
  const r = await syncCoros(store, { now: NOW });
  assert.equal(r.added, 2);
  const a = (await listActivities(store)).find((x) => x.id === "111111111111111111");
  assert.deepEqual(a.track, []);
  assert.match(a.warnings[0], /tracé/);
  assert.ok(r.warnings.length > 0);
});

test("jeton expiré : renouvellement avec le refresh_token", async () => {
  const { store, fake } = await connected();
  const tokens = await store.get("coros/tokens", { type: "json" });
  await store.setJSON("coros/tokens", { ...tokens, expiresAt: Date.now() - 1000 });
  await syncCoros(store, { now: NOW });
  const refresh = fake.log.tokenBodies.find((b) => b.grant_type === "refresh_token");
  assert.equal(refresh.refresh_token, "refresh-1");
  assert.equal(refresh.client_id, "client-abc");
  assert.equal((await store.get("coros/tokens", { type: "json" })).refreshToken, "refresh-2");
  assert.ok(fake.log.authHeaders.every((h) => h === "Bearer access-2"));
});

test("401 du serveur MCP : renouvellement forcé puis nouvel essai", async () => {
  const { store, fake } = await connected({ rejectFirstMcp: true });
  const r = await syncCoros(store, { now: NOW });
  assert.equal(r.added, 2);
  assert.equal(fake.log.authHeaders[0], "Bearer access-1");
  assert.equal(fake.log.authHeaders.at(-1), "Bearer access-2");
});

test("refresh_token révoqué : erreur enregistrée dans le statut", async () => {
  const { store } = await connected();
  const tokens = await store.get("coros/tokens", { type: "json" });
  await store.setJSON("coros/tokens", { ...tokens, expiresAt: 0, refreshToken: "REVOKED" });
  await assert.rejects(syncCoros(store, { now: NOW }), (e) => e.code === "reauth");
  assert.match((await corosStatus(store)).lastError, /invalid_grant/);
});

test("non connecté : erreur not_connected", async () => {
  await assert.rejects(syncCoros(memoryStore(), { now: NOW }), (e) => e.code === "not_connected");
});

test("format Coros inattendu : erreur explicite plutôt que silence", async () => {
  const { store } = await connected({ records: "1. ???\nLabelId: 12 mais sans le reste" });
  await assert.rejects(syncCoros(store, { now: NOW }), /Format de réponse Coros inattendu\. Début de la réponse : 1\. \?\?\? LabelId: 12 mais/);
  assert.match((await corosStatus(store)).lastError, /Début de la réponse/);
});

test("aucune course : succès sans ajout", async () => {
  const { store } = await connected({ records: "No sport records found." });
  const r = await syncCoros(store, { now: NOW });
  assert.deepEqual([r.seen, r.added], [0, 0]);
});

test("McpClient refuse les erreurs d'outil", async () => {
  const f = async (u, init) => {
    const msg = JSON.parse(init.body);
    if (msg.id === undefined) return new Response(null, { status: 202 });
    const result = msg.method === "initialize" ? {} : { isError: true, content: [{ type: "text", text: "pas de chance" }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }), { headers: { "content-type": "application/json" } });
  };
  const c = new McpClient("https://x/mcp", "t", f);
  await c.init();
  await assert.rejects(c.tool("querySportRecords", {}), /pas de chance/);
});
