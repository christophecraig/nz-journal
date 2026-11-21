// Synchronisation des courses Coros -> Netlify Blobs.
// Le « store » est passé en paramètre (Netlify Blobs en prod, stub en test).

import { createHash, randomBytes } from "node:crypto";
import { decodeFitGps, simplifyTrack } from "./fit.mjs";

const SCOPE = "mcp.tools offline_access";
const CLIENT_NAME = "Carnet de bord NZ";
const RUN_CODES = [100, 101, 102, 103]; // course extérieure, tapis, trail, piste
const KIND_BY_CODE = { 100: "run", 101: "run", 102: "trail", 103: "run" };
const PENDING_TTL_MS = 15 * 60 * 1000;
const IN_PROGRESS_MARGIN_MS = 3 * 60 * 1000; // marge après la fin avant import (le FIT n'est pas toujours prêt tout de suite)
const MAX_FIT_BYTES = 8 * 1024 * 1024;

const region = () => (process.env.COROS_REGION || "eu").toLowerCase().replace(/[^a-z]/g, "");
export const baseUrl = () => `https://mcp${region()}.coros.com`;
export const mcpUrl = () => `${baseUrl()}/mcp`;
export const syncFloor = () => process.env.COROS_SYNC_FROM || "2026-11-15"; // arrivée en Nouvelle-Zélande

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sha256 = (s) => createHash("sha256").update(s).digest();
const timeout = (ms) => AbortSignal.timeout(ms);
const sample = (t) => String(t).replace(/\s+/g, " ").trim().slice(0, 350);

class CorosError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* ---------------- OAuth (code + PKCE, enregistrement dynamique du client) ---------------- */

export async function discover() {
  const r = await fetch(`${baseUrl()}/.well-known/oauth-authorization-server`, { signal: timeout(15000) });
  if (!r.ok) throw new CorosError(`Découverte OAuth Coros impossible (HTTP ${r.status})`);
  const meta = await r.json();
  for (const k of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
    if (!meta[k]) throw new CorosError(`Métadonnées OAuth Coros incomplètes (${k})`);
  }
  return meta;
}

async function getClient(store, meta, redirectUri) {
  const key = `coros/client/${createHash("sha1").update(redirectUri).digest("hex")}`;
  const saved = await store.get(key, { type: "json" });
  if (saved?.client_id) return saved;
  const r = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
    signal: timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.client_id) {
    throw new CorosError(`Enregistrement du client Coros refusé (HTTP ${r.status}) ${data.error_description || data.error || ""}`.trim());
  }
  const client = { client_id: data.client_id, ...(data.client_secret ? { client_secret: data.client_secret } : {}) };
  await store.setJSON(key, client);
  return client;
}

/** Renvoie l'URL de consentement Coros vers laquelle rediriger le navigateur. */
export async function startAuth(store, origin) {
  const redirectUri = `${origin}/api/coros/callback`;
  const meta = await discover();
  const client = await getClient(store, meta, redirectUri);
  const state = b64url(randomBytes(16));
  const verifier = b64url(randomBytes(48));
  await store.setJSON(`coros/pending/${state}`, { verifier, redirectUri, client, createdAt: Date.now() });
  const u = new URL(meta.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    code_challenge: b64url(sha256(verifier)),
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

async function tokenRequest(meta, client, params) {
  const body = new URLSearchParams({ ...params, client_id: client.client_id });
  if (client.client_secret) body.set("client_secret", client.client_secret);
  const r = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    const reason = `${data.error || "erreur"}${data.error_description ? " : " + data.error_description : ""}`;
    throw new CorosError(`Jeton Coros refusé (${reason})`, { code: data.error === "invalid_grant" ? "reauth" : undefined });
  }
  return data;
}

const toTokenRecord = (data, client, prev) => ({
  accessToken: data.access_token,
  refreshToken: data.refresh_token || prev?.refreshToken || null,
  expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  client,
});

/** Termine la connexion : échange le code contre des jetons. Lève une exception si l'état est invalide. */
export async function completeAuth(store, query) {
  const state = query.get("state");
  if (!state || !/^[A-Za-z0-9_-]{10,64}$/.test(state)) throw new CorosError("Paramètre state invalide");
  const key = `coros/pending/${state}`;
  const pending = await store.get(key, { type: "json" });
  if (!pending) throw new CorosError("Connexion expirée ou déjà utilisée, recommence");
  await store.delete(key); // usage unique
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) throw new CorosError("Connexion expirée, recommence");
  if (query.get("error")) throw new CorosError(`Coros a refusé l'autorisation (${query.get("error")})`);
  const code = query.get("code");
  if (!code) throw new CorosError("Code d'autorisation manquant");
  const meta = await discover();
  const data = await tokenRequest(meta, pending.client, {
    grant_type: "authorization_code",
    code,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
  });
  await store.setJSON("coros/tokens", toTokenRecord(data, pending.client, null));
}

async function getAccessToken(store, { force = false } = {}) {
  const tokens = await store.get("coros/tokens", { type: "json" });
  if (!tokens) throw new CorosError("Coros n'est pas connecté", { code: "not_connected" });
  if (!force && tokens.expiresAt - Date.now() > 120000) return tokens.accessToken;
  if (!tokens.refreshToken) throw new CorosError("Reconnexion Coros nécessaire (pas de jeton de renouvellement)", { code: "reauth" });
  const meta = await discover();
  const data = await tokenRequest(meta, tokens.client, { grant_type: "refresh_token", refresh_token: tokens.refreshToken });
  const next = toTokenRecord(data, tokens.client, tokens);
  await store.setJSON("coros/tokens", next);
  return next.accessToken;
}

/* ---------------- Client MCP minimal (HTTP « streamable ») ---------------- */

export class McpClient {
  constructor(url, token, fetchImpl = fetch) {
    this.url = url;
    this.token = token;
    this.fetch = fetchImpl;
    this.sessionId = null;
    this.nextId = 1;
  }

  async post(message) {
    const headers = {
      authorization: `Bearer ${this.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const r = await this.fetch(this.url, { method: "POST", headers, body: JSON.stringify(message), signal: timeout(25000) });
    if (r.status === 401) throw new CorosError("Jeton Coros refusé par le serveur MCP", { status: 401 });
    if (!r.ok && r.status !== 202) throw new CorosError(`Serveur MCP Coros : HTTP ${r.status}`, { status: r.status });
    const sid = r.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (message.id === undefined) return null; // notification
    const text = await r.text();
    return parseRpcResponse(text, r.headers.get("content-type") || "", message.id);
  }

  async init() {
    await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "carnet-nz", version: "1.0.0" } },
    });
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async tool(name, args) {
    const res = await this.post({ jsonrpc: "2.0", id: this.nextId++, method: "tools/call", params: { name, arguments: args } });
    const text = unwrapText((res.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n"));
    if (res.isError) throw new CorosError(`Outil Coros ${name} en erreur : ${text.slice(0, 200)}`);
    return text;
  }
}

/** Coros renvoie son texte sous forme de chaîne JSON entre guillemets (« "Sport Records…\n… »). On la décode. */
export function unwrapText(text) {
  const t = String(text).trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      const v = JSON.parse(t);
      if (typeof v === "string") return v;
    } catch { /* texte brut qui commence par un guillemet : on le garde tel quel */ }
  }
  return String(text);
}

export function parseRpcResponse(text, contentType, id) {
  let candidates = [];
  if (contentType.includes("text/event-stream")) {
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (data) {
        try { candidates.push(JSON.parse(data)); } catch { /* ignore */ }
      }
    }
  } else {
    const parsed = JSON.parse(text);
    candidates = Array.isArray(parsed) ? parsed : [parsed];
  }
  const msg = candidates.find((m) => m && m.id === id);
  if (!msg) throw new CorosError("Réponse MCP Coros introuvable");
  if (msg.error) throw new CorosError(`Erreur MCP Coros : ${msg.error.message || JSON.stringify(msg.error)}`);
  return msg.result;
}

/* ---------------- Analyse des réponses textuelles de Coros ---------------- */

const toSeconds = (s) => {
  const p = String(s).split(":").map(Number);
  if (p.some((n) => !Number.isFinite(n))) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : null;
};
const num = (re, s) => {
  const m = re.exec(s);
  return m ? Number(m[1]) : null;
};

export function parseRecords(text) {
  const blocks = String(text).split(/^\s*\d+\.\s+/m).slice(1);
  const out = [];
  for (const b of blocks) {
    const date = /(\d{4}-\d{2}-\d{2})/.exec(b.split("\n")[0])?.[1];
    const id = /label\s*id\s*[:=]\s*(\d+)/i.exec(b)?.[1];
    const sportType = num(/sport\s*type\s*[:=]\s*(\d+)/i, b);
    if (!date || !id || !sportType) continue;
    let startTs = num(/startTimestamp=(\d+)/, b);
    if (startTs && startTs > 1e12) startTs = Math.round(startTs / 1000);
    let endTs = num(/endTimestamp=(\d+)/, b);
    if (endTs && endTs > 1e12) endTs = Math.round(endTs / 1000);
    const coords = /Start Coordinates:\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(b);
    const durationSec = toSeconds(/Duration:\s*([\d:]+)/.exec(b)?.[1] ?? "");
    const distanceKm = num(/Distance:\s*([\d.]+)\s*km/, b);
    let paceSecPerKm = toSeconds(/Average Pace:\s*(\d+:\d+)/.exec(b)?.[1] ?? "");
    if (!paceSecPerKm && durationSec && distanceKm) paceSecPerKm = Math.round(durationSec / distanceKm);
    out.push({
      id,
      date,
      sportType,
      startTs,
      endTs,
      location: (/Location:\s*(.+)/.exec(b)?.[1] ?? "").trim(),
      start: coords ? { lat: Number(coords[1]), lng: Number(coords[2]) } : null,
      durationSec,
      distanceKm,
      paceSecPerKm,
      avgHr: num(/Avg HR:\s*(\d+)/, b),
      calories: num(/Calories:\s*(\d+)/, b),
    });
  }
  return out;
}

export function parseDetail(text) {
  const t = String(text);
  const elev = /Elevation Gain \/ Loss:\s*(\d+)\s*m\s*\/\s*(\d+)\s*m/.exec(t);
  return {
    elevGain: elev ? Number(elev[1]) : null,
    elevLoss: elev ? Number(elev[2]) : null,
    cadence: num(/Average Cadence:\s*(\d+)/, t),
  };
}

export const extractFitUrl = (text) => /https?:\/\/[^\s"'<>]+\.fit\b/.exec(String(text))?.[0] ?? null;

/* ---------------- Synchronisation ---------------- */

const ymdCompact = (d) => d.toISOString().slice(0, 10).replaceAll("-", "");

async function fetchTrack(url, fetchImpl) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !u.hostname.endsWith(".coros.com")) throw new CorosError("URL FIT inattendue");
  const r = await fetchImpl(url, { signal: timeout(25000) });
  if (!r.ok) throw new CorosError(`Téléchargement FIT : HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_FIT_BYTES) throw new CorosError("Fichier FIT trop volumineux");
  return simplifyTrack(decodeFitGps(buf).points, 250);
}

async function buildActivity(mcp, rec, fetchImpl) {
  const warnings = [];
  let detail = { elevGain: null, elevLoss: null, cadence: null };
  try {
    detail = parseDetail(await mcp.tool("getActivityDetail", { labelId: rec.id, sportType: rec.sportType }));
  } catch (e) {
    warnings.push(`détail : ${e.message}`);
  }
  let track = [];
  if (rec.sportType !== 101) {
    try {
      const url = extractFitUrl(await mcp.tool("queryActivityFitFileDownloadUrls", { labelId: rec.id, sportType: rec.sportType, limit: 1 }));
      if (url) track = await fetchTrack(url, fetchImpl);
      else warnings.push("tracé : pas de fichier FIT");
    } catch (e) {
      warnings.push(`tracé : ${e.message}`);
    }
  }
  return {
    id: rec.id,
    date: rec.date,
    kind: KIND_BY_CODE[rec.sportType] || "run",
    indoor: rec.sportType === 101,
    startTs: rec.startTs,
    endTs: rec.endTs,
    durationSec: rec.durationSec,
    distanceKm: rec.distanceKm,
    paceSecPerKm: rec.paceSecPerKm,
    avgHr: rec.avgHr,
    calories: rec.calories,
    ...detail,
    location: rec.location,
    start: rec.start,
    track,
    warnings,
    syncedAt: new Date().toISOString(),
  };
}

async function runSync(store, token, { days, maxNew, now, fetchImpl }) {
  const mcp = new McpClient(mcpUrl(), token, fetchImpl);
  await mcp.init();
  const floor = syncFloor();
  const since = new Date(now.getTime() - days * 86400000);
  const startDate = ymdCompact(since) > floor.replaceAll("-", "") ? ymdCompact(since) : floor.replaceAll("-", "");
  // Tous les paramètres sont obligatoires côté Coros (0 ou "" = filtre désactivé). endDate "" = aujourd'hui (fuseau du compte).
  const text = await mcp.tool("querySportRecords", {
    startDate,
    endDate: "",
    sportTypeCodes: RUN_CODES,
    minDistanceKm: 0,
    maxDistanceKm: 0,
    minDurationMinutes: 0,
    maxDurationMinutes: 0,
    maxAveragePace: "",
    locationKeyword: "",
    limit: 50,
  });
  const records = parseRecords(text);
  if (!records.length && /label\s*id/i.test(text)) {
    throw new CorosError(`Format de réponse Coros inattendu. Début de la réponse : ${sample(text)}`);
  }
  let added = 0;
  const warnings = [];
  for (const rec of records) {
    if (rec.date < floor || !/^\d+$/.test(rec.id) || !RUN_CODES.includes(rec.sportType)) continue;
    // Course encore en cours chez Coros : distance et durée partielles, pas de FIT. On attend qu'elle soit terminée.
    if (rec.endTs && rec.endTs * 1000 > now.getTime() - IN_PROGRESS_MARGIN_MS) continue;
    const existing = await store.get(`activities/${rec.id}`, { type: "json" });
    // Déjà importée avec les mêmes chiffres : rien à faire. Sinon (importée trop tôt) on la réimporte.
    if (existing && existing.distanceKm === rec.distanceKm && existing.durationSec === rec.durationSec) continue;
    if (added >= maxNew) break;
    const activity = await buildActivity(mcp, rec, fetchImpl);
    await store.setJSON(`activities/${rec.id}`, activity);
    warnings.push(...activity.warnings.map((w) => `${rec.date} ${w}`));
    added++;
  }
  return { seen: records.length, added, warnings };
}

export async function syncCoros(store, { days = 14, maxNew = 5, now = new Date(), fetchImpl = fetch } = {}) {
  const prev = (await store.get("coros/status", { type: "json" })) || {};
  try {
    let token = await getAccessToken(store);
    let result;
    try {
      result = await runSync(store, token, { days, maxNew, now, fetchImpl });
    } catch (e) {
      if (e.status !== 401) throw e;
      token = await getAccessToken(store, { force: true });
      result = await runSync(store, token, { days, maxNew, now, fetchImpl });
    }
    await store.setJSON("coros/status", {
      lastSync: now.toISOString(),
      lastError: null,
      lastAdded: result.added,
      lastWarnings: result.warnings.slice(0, 5),
    });
    return result;
  } catch (e) {
    await store.setJSON("coros/status", { ...prev, lastErrorAt: now.toISOString(), lastError: String(e.message).slice(0, 800) });
    throw e;
  }
}

export async function listActivities(store) {
  const { blobs } = await store.list({ prefix: "activities/" });
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return all.filter(Boolean).sort((a, b) => (a.startTs || 0) - (b.startTs || 0));
}

export async function corosStatus(store) {
  const [tokens, status, { blobs }] = await Promise.all([
    store.get("coros/tokens", { type: "json" }),
    store.get("coros/status", { type: "json" }),
    store.list({ prefix: "activities/" }),
  ]);
  return {
    connected: !!tokens,
    lastSync: status?.lastSync ?? null,
    lastError: status?.lastError ?? null,
    lastAdded: status?.lastAdded ?? null,
    activityCount: blobs.length,
  };
}
