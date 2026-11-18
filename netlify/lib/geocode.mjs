/**
 * Recherche de lieux (géocodage) pour l'éditeur. Passe par le serveur pour :
 *  - respecter les règles d'usage (identifiant d'application, cache, 1 requête/s pour Nominatim) ;
 *  - ne jamais exposer la recherche aux visiteurs (route réservée à l'admin).
 * Source principale : Photon (Komoot). Secours, sur demande explicite : Nominatim (OpenStreetMap).
 */
const PHOTON = () => process.env.PHOTON_URL || "https://photon.komoot.io";
const NOMINATIM = () => process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const UA = "nz-journal (carnet de voyage personnel)";
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // par instance de fonction ; suffisant, on ne stocke rien en Blobs

let lastNominatim = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cached = (key) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
  cache.delete(key);
  return null;
};
const remember = (key, v) => {
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(key, { t: Date.now(), v });
  return v;
};

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const clean = (items) =>
  items.filter((r) => r.name && finite(r.lat) && finite(r.lng) && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180);

async function getJson(url, { nominatim = false } = {}) {
  if (nominatim) {
    const wait = 1100 - (Date.now() - lastNominatim);
    if (wait > 0) await sleep(wait);
    lastNominatim = Date.now();
  }
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Service de recherche indisponible (${res.status})`);
  return res.json();
}

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

function fromPhoton(data) {
  return clean(
    (data?.features || []).map((f) => {
      const p = f?.properties || {};
      const [lng, lat] = f?.geometry?.coordinates || [];
      const street = [p.housenumber, p.street].filter(Boolean).join(" ");
      const name = p.name || street || p.city || "";
      const detail = uniq([p.name ? street : "", p.district, p.city !== p.name ? p.city : "", p.state, p.country]).join(", ");
      return { name: String(name).slice(0, 120), detail: detail.slice(0, 160), lat, lng };
    })
  );
}

function fromNominatim(data) {
  return clean(
    (Array.isArray(data) ? data : data ? [data] : []).map((r) => {
      const parts = String(r.display_name || "").split(", ");
      const name = r.name || parts[0] || "";
      const detail = (parts[0] === name ? parts.slice(1) : parts).join(", ");
      return { name: String(name).slice(0, 120), detail: detail.slice(0, 160), lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
    })
  );
}

const coord = (v) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** mode : "photon" (par défaut, recherche pendant la frappe) ou "nominatim" (secours, à la demande). */
export async function searchPlaces(q, { lat, lon, mode = "photon" } = {}) {
  q = String(q || "").trim().slice(0, 120);
  if (q.length < 2) return [];
  const la = coord(lat), lo = coord(lon);
  const bias = la !== null && lo !== null && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
  const key = `s|${mode}|${q.toLowerCase()}|${bias ? la.toFixed(1) + "," + lo.toFixed(1) : ""}`;
  const hit = cached(key);
  if (hit) return hit;
  let out;
  if (mode === "nominatim") {
    const u = new URL("/search", NOMINATIM());
    u.search = new URLSearchParams({ q, format: "jsonv2", limit: "6", addressdetails: "0" });
    if (bias) u.searchParams.set("viewbox", `${lo - 3},${la + 3},${lo + 3},${la - 3}`); // préférence, pas une contrainte
    out = fromNominatim(await getJson(u, { nominatim: true }));
  } else {
    const u = new URL("/api/", PHOTON());
    u.search = new URLSearchParams({ q, limit: "6" });
    if (bias) {
      u.searchParams.set("lat", String(la));
      u.searchParams.set("lon", String(lo));
    }
    out = fromPhoton(await getJson(u));
  }
  return remember(key, out);
}

/** Nom lisible d'un point (bouton « Ma position », choix sur la carte). Renvoie null si rien de trouvé ou service indisponible. */
export async function reversePlace(lat, lon) {
  const la = coord(lat), lo = coord(lon);
  if (la === null || lo === null || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  const key = `r|${la.toFixed(4)},${lo.toFixed(4)}`;
  const hit = cached(key);
  if (hit) return hit;
  try {
    const u = new URL("/reverse", PHOTON());
    u.search = new URLSearchParams({ lat: String(la), lon: String(lo) });
    const [first] = fromPhoton(await getJson(u));
    return first ? remember(key, first) : null;
  } catch {
    return null;
  }
}
