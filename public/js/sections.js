// Puces « ＋ Repas / ＋ Bar / ＋ Activité » de l'éditeur : chacune insère un titre Markdown dans le récit.

export const SECTIONS = [
  { id: "repas", title: "🍽 Repas" },
  { id: "bar", title: "🍺 Bar" },
  { id: "activite", title: "🥾 Activité" },
];

/**
 * Insère « ## titre » à la position `pos` (fin du texte si `pos` n'est pas un entier), avec les lignes vides qu'il faut.
 * Renvoie le nouveau texte et la position du curseur : juste sous le titre, prêt à écrire.
 */
export function insertSection(text, pos, title) {
  const src = String(text ?? "");
  const at = Number.isInteger(pos) ? Math.min(Math.max(pos, 0), src.length) : src.length;
  const before = src.slice(0, at);
  const after = src.slice(at);
  const gap = !before ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const head = `${before}${gap}## ${title}\n\n`;
  return { text: head + after, cursor: head.length };
}
