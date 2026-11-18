// Pastille « nouveau » : tout se passe dans le navigateur du visiteur (localStorage), rien n'est envoyé nulle part.
const KEY = "nzj_seen";

/** Stockage tolérant : localStorage peut être absent, bloqué ou plein. */
export function safeStorage(getter = () => globalThis.localStorage) {
  return {
    get(k) { try { return getter().getItem(k); } catch { return null; } },
    set(k, v) { try { getter().setItem(k, v); return true; } catch { return false; } },
  };
}

/**
 * État : { first: ISO de la première visite, seen: { AAAA-MM-JJ: updatedAt déjà vu } }.
 * Première visite : on mémorise l'instant, aucune pastille. Ensuite, une fiche est « nouvelle » si elle a été créée ou
 * modifiée après la première visite et qu'on n'a pas ouvert cette version. Stockage indisponible : aucune pastille.
 */
export function createSeen(storage = safeStorage(), now = () => new Date().toISOString()) {
  let st = null;
  try {
    const raw = storage.get(KEY);
    st = raw ? JSON.parse(raw) : null;
  } catch { st = null; }
  if (!st || typeof st.first !== "string" || typeof st.seen !== "object" || !st.seen) {
    st = { first: now(), seen: {} };
    if (!storage.set(KEY, JSON.stringify(st))) return { enabled: false, isNew: () => false, markSeen() {} };
  }
  return {
    enabled: true,
    isNew(entry) {
      if (!entry?.updatedAt || entry.draft) return false;
      return entry.updatedAt > st.first && st.seen[entry.date] !== entry.updatedAt;
    },
    markSeen(entry) {
      if (!entry?.updatedAt || st.seen[entry.date] === entry.updatedAt) return;
      st.seen[entry.date] = entry.updatedAt;
      // on ne garde que les jours qui existent encore côté lecture : pas de croissance infinie
      const keys = Object.keys(st.seen);
      if (keys.length > 200) for (const k of keys.sort().slice(0, keys.length - 200)) delete st.seen[k];
      storage.set(KEY, JSON.stringify(st));
    },
  };
}
