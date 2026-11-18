import test from "node:test";
import assert from "node:assert/strict";
import { createDraftStore, shouldOffer, stable, sanitizeForm, draftKey } from "../public/js/draft.js";

const mem = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => (m.set(k, v), true), remove: (k) => m.delete(k), m }; };
const K = "11111111-2222-3333-4444-555555555555.jpg";
const form = (o = {}) => ({ title: "T", text: "Bonjour", date: "2026-11-20", draft: false, routeMode: "drive", photos: [{ key: K, thumb: K, caption: "c" }], audios: [], videos: [{ url: "https://youtu.be/abcdefghijk", title: "" }], places: [{ id: "p1", name: "Welly", lat: -41.28, lng: 174.77 }], ...o });

test("aller-retour : un brouillon par date, effacé par clear", () => {
  const st = mem();
  const d = createDraftStore(st, () => "2026-11-20T10:00:00.000Z");
  assert.equal(d.load("2026-11-20"), null);
  assert.equal(d.save("2026-11-20", form()), true);
  d.save("2026-11-21", form({ title: "autre" }));
  assert.deepEqual(d.load("2026-11-20"), { ts: "2026-11-20T10:00:00.000Z", form: form() });
  assert.equal(d.load("2026-11-21").form.title, "autre");
  d.clear("2026-11-20");
  assert.equal(d.load("2026-11-20"), null);
  assert.ok(st.m.has(draftKey("2026-11-21")));
});

test("stockage plein, bloqué ou corrompu : aucune exception", () => {
  const full = createDraftStore({ get: () => null, set: () => false, remove: () => true });
  assert.equal(full.save("2026-11-20", form()), false);
  const throwing = { get() { throw new Error("x"); }, set() { throw new Error("x"); }, remove() { throw new Error("x"); } };
  const d = createDraftStore(throwing);
  assert.equal(d.save("2026-11-20", form()), false);
  assert.equal(d.load("2026-11-20"), null);
  d.clear("2026-11-20");
  const bad = createDraftStore({ get: () => "{pas du json", set: () => true, remove: () => true });
  assert.equal(bad.load("2026-11-20"), null);
});

test("sanitizeForm : données abîmées neutralisées", () => {
  assert.equal(sanitizeForm(null), null);
  assert.equal(sanitizeForm("x"), null);
  const f = sanitizeForm({ title: 5, text: null, photos: [{ key: "../evil" }, { key: K }], places: [{ lat: "x", lng: 1 }, { lat: 1, lng: 2 }], videos: [{ url: "javascript:1" }], audios: "non" });
  assert.deepEqual([f.title, f.text, f.photos.length, f.places.length, f.videos.length, f.audios.length], ["", "", 1, 1, 0, 0]);
});

test("shouldOffer : plus récent que la fiche ET différent de l'affichage", () => {
  const saved = { ts: "2026-11-20T10:00:00.000Z", form: form({ text: "plus long" }) };
  assert.equal(shouldOffer(saved, { updatedAt: "2026-11-20T09:00:00.000Z" }, form()), true);
  assert.equal(shouldOffer(saved, { updatedAt: "2026-11-20T11:00:00.000Z" }, form()), false); // fiche plus récente : brouillon périmé
  assert.equal(shouldOffer(saved, undefined, form()), true); // nouveau jour
  assert.equal(shouldOffer({ ...saved, form: form() }, undefined, form()), false); // identique : rien à proposer
  assert.equal(shouldOffer(null, undefined, form()), false);
});

test("stable : indépendant de l'ordre des clés, ignore undefined", () => {
  assert.equal(stable({ a: 1, b: [1, { c: 2, d: undefined }] }), stable({ b: [1, { c: 2 }], a: 1 }));
  assert.notEqual(stable({ a: 1 }), stable({ a: 2 }));
});
