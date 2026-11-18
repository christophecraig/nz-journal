import test from "node:test";
import assert from "node:assert/strict";
import { createSeen, safeStorage } from "../public/js/seen.js";

const mem = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => (m.set(k, v), true), m }; };
const E = (date, updatedAt, o = {}) => ({ date, updatedAt, ...o });

test("première visite : aucune pastille, même sur les jours existants", () => {
  const s = createSeen(mem(), () => "2026-11-20T00:00:00.000Z");
  assert.equal(s.isNew(E("2026-11-18", "2026-11-19T00:00:00.000Z")), false);
});

test("jour modifié après la première visite : signalé, puis plus une fois ouvert", () => {
  const st = mem();
  createSeen(st, () => "2026-11-20T00:00:00.000Z"); // visite 1
  const s = createSeen(st, () => "2026-11-25T00:00:00.000Z"); // visite 2 (état relu)
  const day = E("2026-11-21", "2026-11-22T10:00:00.000Z");
  assert.equal(s.isNew(day), true);
  s.markSeen(day);
  assert.equal(s.isNew(day), false);
  assert.equal(createSeen(st).isNew(day), false); // persisté
  assert.equal(s.isNew(E("2026-11-21", "2026-11-23T10:00:00.000Z")), true); // modifié à nouveau
});

test("brouillon ou fiche sans updatedAt : jamais signalé", () => {
  const st = mem();
  createSeen(st, () => "2026-11-01T00:00:00.000Z");
  const s = createSeen(st);
  assert.equal(s.isNew(E("2026-11-21", "2026-11-22T00:00:00.000Z", { draft: true })), false);
  assert.equal(s.isNew({ date: "2026-11-21" }), false);
  assert.equal(s.isNew(null), false);
});

test("stockage indisponible, plein ou corrompu : aucun effet, aucune exception", () => {
  const blocked = safeStorage(() => { throw new Error("SecurityError"); });
  const s = createSeen(blocked);
  assert.equal(s.isNew(E("2026-11-21", "2030-01-01T00:00:00.000Z")), false);
  s.markSeen(E("2026-11-21", "2030-01-01T00:00:00.000Z"));
  const full = { get: () => null, set: () => false };
  assert.equal(createSeen(full).enabled, false);
  const bad = { get: () => "{pas du json", set: () => true };
  // état corrompu : on repart d'une « première visite » (ici à l'instant 2026-11-30), donc rien n'est signalé
  assert.equal(createSeen(bad, () => "2026-11-30T00:00:00.000Z").isNew(E("2026-11-21", "2026-11-22T00:00:00.000Z")), false);
});

test("l'état mémorisé reste borné", () => {
  const st = mem();
  createSeen(st, () => "2000-01-01T00:00:00.000Z");
  const s = createSeen(st);
  for (let i = 0; i < 260; i++) s.markSeen(E(`2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + Math.floor(i / 12)).padStart(2, "0")}`, "2026-11-22T00:00:00.000Z"));
  assert.ok(Object.keys(JSON.parse(st.get("nzj_seen")).seen).length <= 200);
});
