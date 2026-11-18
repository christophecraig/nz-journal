// « Le voyage en chiffres » : calcul pur (sans DOM, testable) des indicateurs de l'accueil.
// Tout est déduit des données déjà chargées (/api/entries et /api/activities) : aucun appel serveur en plus.

const DAY_MS = 86400000;
const R_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;

/** Distance à vol d'oiseau entre deux points [lat, lng], en km. */
export function haversineKm([la1, ln1], [la2, ln2]) {
  const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(ln2 - ln1) / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(a));
}

/** Longueur d'une ligne [[lat,lng],…] en km. */
export function pathKm(points) {
  if (!Array.isArray(points)) return 0;
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  return km;
}

const utcDay = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/**
 * Indicateurs du voyage. Renvoie null s'il n'y a aucune donnée (le bandeau reste alors masqué).
 * @param {{entries?: object[], activities?: object[], start?: string, end?: string, today: string}} p
 *   start / end / today au format AAAA-MM-JJ (jour local).
 */
export function computeTripStats({ entries = [], activities = [], start, end, today }) {
  if (!entries.length && !activities.length) return null;

  const carKm = entries.reduce((s, e) => (e.routeMode === "none" ? s : s + pathKm(e.route?.points)), 0);
  const runKm = activities.reduce((s, a) => s + (Number(a.distanceKm) || 0), 0);
  const elevGain = activities.reduce((s, a) => s + (Number(a.elevGain) || 0), 0);
  const stops = entries.reduce((s, e) => s + (e.places?.length || 0), 0);
  const photos = entries.reduce((s, e) => s + (e.photos?.length || 0), 0);
  const daysWritten = entries.filter((e) => (e.text || "").trim() || (e.title || "").trim()).length;

  let day = null;
  let total = null;
  if (start && end && utcDay(end) >= utcDay(start)) {
    total = Math.round((utcDay(end) - utcDay(start)) / DAY_MS) + 1;
    const n = Math.round((utcDay(today) - utcDay(start)) / DAY_MS) + 1;
    if (n >= 1) day = Math.min(n, total); // avant le départ ou après le retour : pas de « jour X »
  }

  return {
    day,
    total,
    carKm: Math.round(carKm),
    runKm: Math.round(runKm * 10) / 10,
    elevGain: Math.round(elevGain),
    stops,
    photos,
    daysWritten,
  };
}

const nf = (n, digits = 0) => n.toLocaleString("fr-FR", { maximumFractionDigits: digits });
const plural = (n, one, many) => `${nf(n)} ${n > 1 ? many : one}`;

/** Liste des puces à afficher ; les compteurs à zéro sont omis. */
export function statChips(s) {
  if (!s) return [];
  const chips = [];
  if (s.day) chips.push({ icon: "🗓", text: `Jour ${s.day} sur ${s.total}` });
  if (s.carKm > 0) chips.push({ icon: "🚗", text: `${nf(s.carKm)} km en voiture` });
  if (s.runKm > 0) chips.push({ icon: "🏃", text: `${nf(s.runKm, 1)} km courus` });
  if (s.elevGain > 0) chips.push({ icon: "⛰", text: `${nf(s.elevGain)} m D+` });
  if (s.stops > 0) chips.push({ icon: "📍", text: plural(s.stops, "étape", "étapes") });
  if (s.photos > 0) chips.push({ icon: "📷", text: plural(s.photos, "photo", "photos") });
  if (s.daysWritten > 0) chips.push({ icon: "✍️", text: plural(s.daysWritten, "jour écrit", "jours écrits") });
  return chips;
}
