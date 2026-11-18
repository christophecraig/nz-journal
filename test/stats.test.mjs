import test from "node:test";
import assert from "node:assert/strict";
import { computeTripStats, haversineKm, pathKm, statChips } from "../public/js/stats.js";

const base = { start: "2026-11-15", end: "2026-12-12", today: "2026-11-20" };

test("haversine : 1° de latitude ≈ 111 km", () => {
  assert.ok(Math.abs(haversineKm([0, 0], [1, 0]) - 111.19) < 0.1);
  assert.equal(haversineKm([-41.2, 173.3], [-41.2, 173.3]), 0);
});

test("pathKm : somme des segments, tolérant aux entrées invalides", () => {
  assert.ok(Math.abs(pathKm([[0, 0], [1, 0], [2, 0]]) - 222.39) < 0.2);
  assert.equal(pathKm(undefined), 0);
  assert.equal(pathKm([[0, 0]]), 0);
});

test("aucune donnée : null (bandeau masqué)", () => {
  assert.equal(computeTripStats({ ...base }), null);
  assert.equal(computeTripStats({ ...base, entries: [], activities: [] }), null);
  assert.deepEqual(statChips(null), []);
});

test("totaux : voiture, course, D+, étapes, photos, jours écrits", () => {
  const entries = [
    { date: "2026-11-16", title: "Arrivée", text: "Bonjour", places: [{}, {}, {}], photos: [{}, {}], routeMode: "drive", route: { points: [[0, 0], [1, 0]] } },
    { date: "2026-11-17", title: "", text: "  ", places: [{}], photos: [], routeMode: "drive", route: { points: [[0, 0], [0, 1]] } },
    { date: "2026-11-18", title: "Sans route", text: "x", places: [{}, {}], photos: [{}], routeMode: "none", route: { points: [[0, 0], [5, 0]] } },
    { date: "2026-11-19", title: "Droites", text: "y", places: [{}, {}], photos: [], routeMode: "drive" }, // route pas calculée
  ];
  const activities = [
    { date: "2026-11-17", distanceKm: 10.04, elevGain: 120 },
    { date: "2026-11-19", distanceKm: 5.5, elevGain: null },
  ];
  const s = computeTripStats({ ...base, entries, activities });
  assert.equal(s.carKm, Math.round(haversineKm([0, 0], [1, 0]) + haversineKm([0, 0], [0, 1]))); // 222 : « none » et sans route ignorés
  assert.equal(s.runKm, 15.5);
  assert.equal(s.elevGain, 120);
  assert.equal(s.stops, 8);
  assert.equal(s.photos, 3);
  assert.equal(s.daysWritten, 3); // la fiche sans titre ni texte n'est pas « écrite »
});

test("seulement des courses (jour sans fiche) : le bandeau existe", () => {
  const s = computeTripStats({ ...base, activities: [{ date: "2026-11-17", distanceKm: 8, elevGain: 50 }] });
  assert.equal(s.runKm, 8);
  assert.equal(s.carKm, 0);
  assert.equal(s.daysWritten, 0);
});

test("jour X sur N", () => {
  const e = [{ date: "2026-11-16", title: "a", text: "b" }];
  const at = (today) => computeTripStats({ ...base, entries: e, today });
  assert.deepEqual([at("2026-11-15").day, at("2026-11-15").total], [1, 28]);
  assert.equal(at("2026-11-20").day, 6);
  assert.equal(at("2026-12-12").day, 28);
  assert.equal(at("2026-12-20").day, 28); // après le retour : plafonné
  assert.equal(at("2026-11-10").day, null); // avant le départ
  assert.equal(computeTripStats({ entries: e, today: "2026-11-20" }).day, null); // dates non configurées
  assert.equal(computeTripStats({ entries: e, start: "2026-12-01", end: "2026-11-01", today: "2026-11-20" }).total, null); // dates incohérentes
});

test("puces : zéros omis, pluriels", () => {
  const chips = statChips({ day: 6, total: 28, carKm: 0, runKm: 0, elevGain: 0, stops: 1, photos: 2, daysWritten: 1 }).map((c) => c.text);
  assert.deepEqual(chips, ["Jour 6 sur 28", "1 étape", "2 photos", "1 jour écrit"]);
  const full = statChips({ day: null, total: null, carKm: 1234, runKm: 15.5, elevGain: 1200, stops: 12, photos: 40, daysWritten: 5 }).map((c) => c.text.replace(/\s/g, " "));
  assert.equal(full[0], "1 234 km en voiture");
  assert.ok(full.includes("15,5 km courus") && full.includes("1 200 m D+") && full.includes("5 jours écrits"));
});
