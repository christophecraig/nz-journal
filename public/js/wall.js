// Mur de photos : ordre et indices (pur, testable). L'indice d'une photo dans `list` est celui du bouton qui l'affiche,
// ce qui garde la navigation précédent/suivant de la visionneuse cohérente d'un jour à l'autre.
export function buildWall(entries) {
  const days = [...entries].filter((e) => e?.photos?.length).sort((a, b) => a.date.localeCompare(b.date));
  const list = days.flatMap((e) => e.photos.map((p) => ({ ...p, date: e.date })));
  let n = 0;
  const groups = days.map((e) => ({ date: e.date, title: e.title || "", photos: e.photos.map((p) => ({ photo: p, index: n++ })) }));
  return { groups, list };
}
