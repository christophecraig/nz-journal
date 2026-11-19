import { getStore } from "@netlify/blobs";
import { createHmac, createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { startAuth, completeAuth, syncCoros, listActivities, corosStatus } from "../lib/coros.mjs";
import { fetchDrivingRoute, routeSig } from "../lib/route.mjs";
import { searchPlaces, reversePlace } from "../lib/geocode.mjs";

export const config = { path: "/api/*" };

const MAX_MEDIA_BYTES = 5.5 * 1024 * 1024; // limite Netlify Functions : ~6 Mo par requête
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

const EXT_BY_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};
const TYPE_BY_EXT = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  webm: "audio/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",
};
const MEDIA_KEY_RE = /^[a-f0-9-]{36}\.(jpg|png|webp|mp3|m4a|aac|webm|ogg|wav)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// globalThis.__CARNET_STORE__ n'existe qu'en test local (store en mémoire).
const storeFactory = () => globalThis.__CARNET_STORE__ ?? getStore({ name: "carnet", consistency: "strong" });

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
  });

// Lectures publiques : le CDN Netlify garde la réponse 30 s (puis la sert périmée 5 min le temps de la rafraîchir en arrière-plan).
// Le navigateur, lui, revalide toujours. Un nouveau jour publié est donc visible en moins d'une minute.
// Les réponses de l'admin (brouillons) ne passent JAMAIS par là : elles restent en `no-store`.
const PUBLIC_CACHE = {
  "cache-control": "public, max-age=0, must-revalidate",
  "netlify-cdn-cache-control": "public, max-age=30, stale-while-revalidate=300",
};

/* ---------- Auth ---------- */

const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
const sign = (payload) => createHmac("sha256", secret()).update(payload).digest("base64url");

function makeToken() {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  return `${exp}.${sign(exp)}`;
}

function isAuthed(req) {
  if (!secret()) return false;
  const h = req.headers.get("authorization") || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [exp, sig] = t.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const good = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return good.length === got.length && timingSafeEqual(good, got);
}

function passwordMatches(given) {
  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected) return false;
  const a = createHash("sha256").update(String(given)).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Validation ---------- */

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const validKey = (k) => typeof k === "string" && MEDIA_KEY_RE.test(k);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const PLACE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const approx2 = (n) => Math.round(n * 100) / 100; // ~1 km : suffisant pour ne pas dévoiler une adresse

/** Les « lieux » d'une fiche sont ses étapes (ordre = ordre du trajet). Les anciennes fiches n'ont ni id, ni heure, ni note : tout reste valide. */
function cleanPlaces(raw) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : [])
    .slice(0, 30)
    .map((p) => {
      let lat = num(p?.lat);
      let lng = num(p?.lng);
      const approx = p?.approx === true;
      if (approx && lat !== null && lng !== null) {
        lat = approx2(lat);
        lng = approx2(lng);
      }
      let id = typeof p?.id === "string" && PLACE_ID_RE.test(p.id) ? p.id : "";
      if (!id || seen.has(id)) id = randomUUID().slice(0, 8);
      seen.add(id);
      const place = { id, name: str(p?.name, 120) || "Lieu", lat, lng };
      if (typeof p?.time === "string" && TIME_RE.test(p.time)) place.time = p.time;
      const note = str(p?.note, 300);
      if (note) place.note = note;
      if (approx) place.approx = true;
      return place;
    })
    .filter((p) => p.lat !== null && p.lng !== null && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
}

function cleanEntry(date, b) {
  const places = cleanPlaces(b.places);
  const placeIds = new Set(places.map((p) => p.id));
  const photos = (Array.isArray(b.photos) ? b.photos : [])
    .slice(0, 60)
    .filter((p) => p && validKey(p.key))
    .map((p) => {
      const photo = { key: p.key, thumb: validKey(p.thumb) ? p.thumb : p.key, caption: str(p.caption, 300) };
      if (typeof p.placeId === "string" && placeIds.has(p.placeId)) photo.placeId = p.placeId;
      return photo;
    });
  const audios = (Array.isArray(b.audios) ? b.audios : [])
    .slice(0, 10)
    .filter((a) => a && validKey(a.key))
    .map((a) => ({ key: a.key, label: str(a.label, 120) }));
  return {
    date,
    title: str(b.title, 200),
    text: str(b.text, 30000),
    photos,
    audios,
    places,
    routeMode: b.routeMode === "none" ? "none" : "drive",
    ...(b.draft === true ? { draft: true } : {}), // absent = publié (les anciennes fiches le restent)
    updatedAt: new Date().toISOString(),
  };
}

const mediaKeysOf = (e) =>
  new Set([
    ...(e?.photos || []).flatMap((p) => [p.key, p.thumb]),
    ...(e?.audios || []).map((a) => a.key),
  ].filter(Boolean));

/* ---------- Handlers ---------- */

/** Les brouillons ne sont renvoyés qu'à l'admin authentifié. */
async function listEntries(s, admin = false) {
  const { blobs } = await s.list({ prefix: "entries/" });
  const all = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  const entries = all.filter((e) => e && (admin || !e.draft)).sort((a, b) => a.date.localeCompare(b.date));
  if (admin) return json({ entries }); // no-store : contient les brouillons
  // La réponse publique varie selon l'en-tête Authorization : une requête authentifiée n'est jamais servie depuis cette entrée de cache.
  return json({ entries }, 200, { ...PUBLIC_CACHE, "netlify-vary": "header=authorization" });
}

async function putEntry(s, date, req) {
  if (!DATE_RE.test(date)) return json({ error: "Date invalide" }, 400);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON invalide" }, 400);
  }
  // Changement de date : la fiche est écrite à la nouvelle date, l'ancienne est retirée (les médias suivent, ils ne dépendent pas de la date)
  const moveTo = typeof body?.moveTo === "string" && body.moveTo !== date ? body.moveTo : null;
  if (moveTo) {
    if (!DATE_RE.test(moveTo)) return json({ error: "Date invalide" }, 400);
    if (await s.get(`entries/${moveTo}`, { type: "json" })) return json({ error: "Une fiche existe déjà à cette date." }, 409);
  }
  const target = moveTo || date;
  const entry = cleanEntry(target, body || {});
  const old = await s.get(`entries/${date}`, { type: "json" });
  // Itinéraire en voiture : calculé ici, une seule fois (réutilisé tant que les étapes ne bougent pas)
  if (entry.routeMode === "drive" && entry.places.length >= 2) {
    const sig = routeSig(entry.places);
    if (old?.route?.sig === sig && Array.isArray(old.route.points)) entry.route = old.route;
    else {
      const points = await fetchDrivingRoute(entry.places);
      if (points) entry.route = { sig, points };
    }
  }
  await s.setJSON(`entries/${target}`, entry);
  if (moveTo) await s.delete(`entries/${date}`);
  // Supprime les médias retirés de la fiche
  const keep = mediaKeysOf(entry);
  for (const k of mediaKeysOf(old)) if (!keep.has(k)) await s.delete(`media/${k}`);
  return json({ entry });
}

async function deleteEntry(s, date) {
  if (!DATE_RE.test(date)) return json({ error: "Date invalide" }, 400);
  const old = await s.get(`entries/${date}`, { type: "json" });
  for (const k of mediaKeysOf(old)) await s.delete(`media/${k}`);
  await s.delete(`entries/${date}`);
  return json({ ok: true });
}

async function uploadMedia(s, req) {
  const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[type];
  if (!ext) return json({ error: `Type de fichier non supporté (${type || "inconnu"})` }, 415);
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) return json({ error: "Fichier vide" }, 400);
  if (buf.byteLength > MAX_MEDIA_BYTES) return json({ error: "Fichier trop lourd (max ~5 Mo)" }, 413);
  const key = `${randomUUID()}.${ext}`;
  await s.set(`media/${key}`, buf, { metadata: { contentType: TYPE_BY_EXT[ext] } });
  return json({ key });
}

async function serveMedia(s, key, req) {
  if (!validKey(key)) return json({ error: "Introuvable" }, 404);
  const r = await s.getWithMetadata(`media/${key}`, { type: "arrayBuffer" });
  if (!r) return json({ error: "Introuvable" }, 404);
  const buf = r.data;
  const total = buf.byteLength;
  const base = {
    "content-type": r.metadata?.contentType || TYPE_BY_EXT[key.split(".").pop()] || "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
  };
  const range = req.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (m[1] === "" && m[2] === "")) {
    return new Response(buf, { status: 200, headers: { ...base, "content-length": String(total) } });
  }
  let start = m[1] === "" ? null : Number(m[1]);
  let end = m[2] === "" ? null : Number(m[2]);
  if (start === null) {
    start = Math.max(0, total - end);
    end = total - 1;
  } else if (end === null || end >= total) {
    end = total - 1;
  }
  if (start > end || start >= total) {
    return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${total}` } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      ...base,
      "content-range": `bytes ${start}-${end}/${total}`,
      "content-length": String(end - start + 1),
    },
  });
}

/* ---------- Routeur ---------- */

export default async (req) => {
  const url = new URL(req.url);
  const [res, id] = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;

  try {
    if (res === "login" && method === "POST") {
      if (!process.env.ADMIN_PASSWORD) {
        return json({ error: "ADMIN_PASSWORD n'est pas défini côté Netlify" }, 503);
      }
      const body = await req.json().catch(() => ({}));
      if (!passwordMatches(body.password ?? "")) {
        await sleep(800);
        return json({ error: "Mot de passe incorrect" }, 401);
      }
      return json({ token: makeToken() });
    }

    if (res === "me" && method === "GET") {
      return isAuthed(req) ? json({ ok: true }) : json({ error: "Non autorisé" }, 401);
    }

    const s = storeFactory();

    if (res === "activities" && method === "GET" && !id) {
      return json({ activities: await listActivities(s) }, 200, PUBLIC_CACHE); // identique pour tous : pas de brouillon ici
    }

    if (res === "coros") {
      if (id === "callback" && method === "GET") {
        // Retour de Coros : l'autorisation est protégée par le paramètre `state` à usage unique.
        try {
          await completeAuth(s, url.searchParams);
          return Response.redirect(`${url.origin}/admin?coros=ok`, 302);
        } catch (e) {
          console.error("Callback Coros :", e.message);
          const prev = (await s.get("coros/status", { type: "json" })) || {};
          await s.setJSON("coros/status", { ...prev, lastErrorAt: new Date().toISOString(), lastError: String(e.message).slice(0, 800) });
          return Response.redirect(`${url.origin}/admin?coros=error`, 302);
        }
      }
      if (!isAuthed(req)) return json({ error: "Non autorisé" }, 401);
      if (id === "status" && method === "GET") return json(await corosStatus(s));
      if (id === "connect" && method === "POST") return json({ url: await startAuth(s, url.origin) });
      if (id === "sync" && method === "POST") {
        const body = await req.json().catch(() => ({}));
        const days = Math.min(Math.max(parseInt(body.days, 10) || 14, 1), 90);
        try {
          return json(await syncCoros(s, { days, maxNew: 2 }));
        } catch (e) {
          console.error("Synchro Coros :", e.message);
          return json({ error: e.message }, e.code === "not_connected" ? 409 : 502);
        }
      }
    }

    if (res === "geocode" && method === "GET" && !id) {
      if (!isAuthed(req)) return json({ error: "Non autorisé" }, 401);
      const q = url.searchParams;
      if (q.get("reverse")) return json({ place: await reversePlace(q.get("lat"), q.get("lon")) });
      try {
        const mode = q.get("mode") === "nominatim" ? "nominatim" : "photon";
        return json({ results: await searchPlaces(q.get("q"), { lat: q.get("lat"), lon: q.get("lon"), mode }), mode });
      } catch (e) {
        console.error("Recherche de lieu :", e.message);
        return json({ error: "Recherche indisponible pour le moment" }, 502);
      }
    }

    if (res === "comments" && method === "DELETE" && id) {
      // Modération : l'admin supprime n'importe quel commentaire (la clé secrète ne quitte jamais le serveur)
      if (!isAuthed(req)) return json({ error: "Non autorisé" }, 401);
      if (!UUID_RE.test(id)) return json({ error: "Identifiant invalide" }, 400);
      const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
      const key = process.env.SUPABASE_SERVICE_KEY || "";
      if (!base || !key) return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_KEY ne sont pas définis côté Netlify" }, 503);
      const r = await fetch(`${base}/rest/v1/comments?id=eq.${id}`, {
        method: "DELETE",
        headers: { apikey: key, authorization: `Bearer ${key}`, prefer: "return=representation" },
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) {
        console.error("Suppression de commentaire :", r.status);
        return json({ error: "Suppression impossible pour le moment" }, 502);
      }
      const rows = await r.json().catch(() => []);
      return json({ deleted: Array.isArray(rows) ? rows.length : 0 });
    }

    if (res === "entries") {
      if (method === "GET" && !id) return await listEntries(s, isAuthed(req));
      if (!isAuthed(req)) return json({ error: "Non autorisé" }, 401);
      if (method === "PUT" && id) return await putEntry(s, id, req);
      if (method === "DELETE" && id) return await deleteEntry(s, id);
    }

    if (res === "media") {
      if (method === "GET" && id) return await serveMedia(s, id, req);
      if (!isAuthed(req)) return json({ error: "Non autorisé" }, 401);
      if (method === "POST" && !id) return await uploadMedia(s, req);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "Erreur serveur" }, 500);
  }
  return json({ error: "Introuvable" }, 404);
};
