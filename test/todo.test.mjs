import test from "node:test";
import assert from "node:assert/strict";
import { daysToWrite } from "../public/js/todo.js";

const e = (...dates) => dates.map((date) => ({ date }));

test("jours sans fiche entre le début et aujourd'hui, brouillons comptés comme écrits", () => {
  const r = daysToWrite({ start: "2026-11-15", end: "2026-12-12", today: "2026-11-19", entries: e("2026-11-15", "2026-11-17") });
  assert.deepEqual(r, { todo: ["2026-11-16", "2026-11-18", "2026-11-19"], total: 5 });
});

test("après la fin du voyage on s'arrête à la date de retour ; avant le début, rien", () => {
  const after = daysToWrite({ start: "2026-12-10", end: "2026-12-12", today: "2027-01-05", entries: [] });
  assert.deepEqual(after, { todo: ["2026-12-10", "2026-12-11", "2026-12-12"], total: 3 });
  assert.deepEqual(daysToWrite({ start: "2026-11-15", today: "2026-11-10", entries: [] }), { todo: [], total: 0 });
});

test("passage de mois et d'année, dates invalides, fin absente", () => {
  const r = daysToWrite({ start: "2026-12-30", today: "2027-01-02", entries: e("2026-12-31") });
  assert.deepEqual(r.todo, ["2026-12-30", "2027-01-01", "2027-01-02"]);
  assert.deepEqual(daysToWrite({ start: "", today: "2026-11-19", entries: [] }), { todo: [], total: 0 });
  assert.deepEqual(daysToWrite({ start: "n'importe quoi", today: "2026-11-19" }), { todo: [], total: 0 });
});
