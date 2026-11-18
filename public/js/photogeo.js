// Géographie des photos : distances, rattachement à l'étape la plus proche, regroupement en lieux.

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

/** Distance en mètres entre deux points (formule de haversine). */
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** L'étape (ayant lat/lng) la plus proche de `pt`, si elle est à moins de `maxM` mètres ; sinon null. */
export function nearestWithin(places, pt, maxM = 400) {
  let best = null;
  let bestD = Infinity;
  for (const p of places || []) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) continue;
    const d = distanceM(p, pt);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best && bestD <= maxM ? best : null;
}

/**
 * Regroupe des photos géolocalisées en lieux : chaque photo rejoint le premier groupe dont le centre est à moins de `radiusM`.
 * `items` : [{ lat, lng, ts?, time?, ref }]. Résultat trié par heure de la première photo : [{ lat, lng, time, items }].
 */
export function clusterPhotos(items, radiusM = 300) {
  const sorted = [...items].sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")));
  const groups = [];
  for (const it of sorted) {
    const g = groups.find((x) => distanceM(x, it) <= radiusM);
    if (g) {
      g.items.push(it);
      g.lat = g.items.reduce((s, x) => s + x.lat, 0) / g.items.length;
      g.lng = g.items.reduce((s, x) => s + x.lng, 0) / g.items.length;
      if (!g.time && it.time) g.time = it.time;
    } else {
      groups.push({ lat: it.lat, lng: it.lng, time: it.time || "", items: [it] });
    }
  }
  return groups;
}
