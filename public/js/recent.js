// Onglet « Commentaires » de l'admin : calculs purs (sans DOM) sur la liste des derniers commentaires.

/** Nombre de commentaires postés après `seenIso` (tous, si l'admin n'a encore rien vu). */
export function countNew(rows, seenIso) {
  const t = Date.parse(seenIso || "");
  return (rows || []).filter((r) => {
    const c = Date.parse(r?.created_at || "");
    return Number.isFinite(c) && (!Number.isFinite(t) || c > t);
  }).length;
}

/** Date du commentaire le plus récent (ISO), ou "" s'il n'y en a pas. */
export function newestDate(rows) {
  let best = 0;
  let iso = "";
  for (const r of rows || []) {
    const c = Date.parse(r?.created_at || "");
    if (Number.isFinite(c) && c > best) { best = c; iso = r.created_at; }
  }
  return iso;
}
