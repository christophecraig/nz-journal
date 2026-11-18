import { simplifyTrack } from "./fit.mjs";

const OSRM_URL = () => process.env.OSRM_URL || "https://router.project-osrm.org";
const MAX_ROUTE_POINTS = 400;

/** Signature des étapes : si elle ne change pas entre deux sauvegardes, on réutilise l'itinéraire déjà calculé. */
export const routeSig = (places) => places.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(";");

/**
 * Demande à OSRM l'itinéraire en voiture passant par les étapes, dans l'ordre.
 * Renvoie [[lat,lng],…] ou null (service indisponible, réponse inattendue…) :
 * l'appelant affiche alors de simples lignes droites. Ne lève jamais d'exception.
 */
export async function fetchDrivingRoute(places) {
  if (places.length < 2) return null;
  const coords = places.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  const url = `${OSRM_URL()}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "nz-journal (carnet de voyage personnel)", accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const line = data?.routes?.[0]?.geometry?.coordinates;
    if (data?.code !== "Ok" || !Array.isArray(line) || line.length < 2) return null;
    // GeoJSON = [lng, lat] ; on stocke [lat, lng] comme les traces Coros
    const pts = line.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])).map(([lng, lat]) => [lat, lng]);
    return pts.length >= 2 ? simplifyTrack(pts, MAX_ROUTE_POINTS) : null;
  } catch {
    return null;
  }
}
