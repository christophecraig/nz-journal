// Brouillon local de l'éditeur : l'état du formulaire (texte, légendes, étapes, vidéos, références de médias déjà envoyés)
// est gardé dans localStorage, un brouillon par date. Jamais de fichier binaire. Tout est tolérant aux pannes de stockage.
import { safeStorage } from "./seen.js";

const PREFIX = "nzj_draft_";
export const draftKey = (date) => PREFIX + date;

/** JSON à clés triées : comparer deux états ne dépend pas de l'ordre des propriétés. */
export function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  }
  return JSON.stringify(v) ?? "null";
}

const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const KEY_RE = /^[a-f0-9-]{36}\.[a-z0-9]{2,4}$/;

/** Remet en forme un brouillon relu du disque (il a pu être abîmé) ; null s'il est inutilisable. */
export function sanitizeForm(f) {
  if (!isObj(f)) return null;
  const places = arr(f.places)
    .filter((p) => isObj(p) && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({ ...p, name: typeof p.name === "string" ? p.name : "Étape" }));
  const ids = new Set(places.map((p) => p.id).filter(Boolean));
  return {
    title: typeof f.title === "string" ? f.title : "",
    text: typeof f.text === "string" ? f.text : "",
    date: typeof f.date === "string" ? f.date : "",
    draft: f.draft === true,
    routeMode: f.routeMode === "none" ? "none" : "drive",
    photos: arr(f.photos)
      .filter((p) => isObj(p) && KEY_RE.test(p.key || ""))
      .map((p) => ({ ...p, caption: typeof p.caption === "string" ? p.caption : "", ...(p.placeId && !ids.has(p.placeId) ? { placeId: undefined } : {}) })),
    audios: arr(f.audios).filter((a) => isObj(a) && KEY_RE.test(a.key || "")).map((a) => ({ ...a, label: typeof a.label === "string" ? a.label : "" })),
    places,
  };
}

/** Faut-il proposer ce brouillon ? Oui s'il est plus récent que la fiche enregistrée et différent de ce qui est affiché. */
export function shouldOffer(saved, entry, currentForm) {
  if (!saved?.form || typeof saved.ts !== "string") return false;
  if (entry?.updatedAt && saved.ts <= entry.updatedAt) return false;
  return stable(saved.form) !== stable(currentForm);
}

export function createDraftStore(storage = safeStorage(), now = () => new Date().toISOString()) {
  return {
    /** false si le stockage est plein ou bloqué (l'éditeur continue normalement). */
    save(date, form) {
      try { return storage.set(draftKey(date), JSON.stringify({ ts: now(), form })); } catch { return false; }
    },
    load(date) {
      try {
        const raw = storage.get(draftKey(date));
        const d = raw ? JSON.parse(raw) : null;
        const form = sanitizeForm(d?.form);
        return form && typeof d.ts === "string" ? { ts: d.ts, form } : null;
      } catch { return null; }
    },
    clear(date) {
      try { storage.remove(draftKey(date)); } catch { /* rien à faire */ }
    },
  };
}
