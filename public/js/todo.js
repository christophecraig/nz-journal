// Jours « à écrire » : les jours du voyage déjà passés (ou en cours) qui n'ont encore aucune fiche. Calcul pur, sans DOM.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const p2 = (n) => String(n).padStart(2, "0");

/**
 * @param {{start: string, end?: string, today: string, entries: {date: string}[]}} p  dates au format AAAA-MM-JJ
 * @returns {{todo: string[], total: number}} `todo` : jours sans fiche (brouillons comptés comme écrits), `total` : jours du voyage écoulés
 */
export function daysToWrite({ start, end, today, entries }) {
  if (!DATE_RE.test(start || "") || !DATE_RE.test(today || "")) return { todo: [], total: 0 };
  const last = DATE_RE.test(end || "") && end < today ? end : today;
  if (last < start) return { todo: [], total: 0 };
  const written = new Set((entries || []).map((e) => e.date));
  const [y, m, d] = start.split("-").map(Number);
  const todo = [];
  let total = 0;
  for (let t = Date.UTC(y, m - 1, d); total < 400; t += 86400000) {
    const dt = new Date(t);
    const ds = `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
    if (ds > last) break;
    total++;
    if (!written.has(ds)) todo.push(ds);
  }
  return { todo, total };
}
