import test from "node:test";
import assert from "node:assert/strict";
import { buildFrames } from "../public/js/replay.js";

const place = (n, lat, lng) => ({ name: n, lat, lng });

test("zéro jour avec géométrie : aucune image", () => {
  assert.deepEqual(buildFrames([], []), []);
  assert.deepEqual(buildFrames([{ date: "2026-11-17", title: "Texte seul", places: [] }], [{ date: "2026-11-18", distanceKm: 5 }]), []);
});

test("un jour, une étape : une image sans ligne", () => {
  const f = buildFrames([{ date: "2026-11-17", title: "Arrivée", places: [place("Welly", -41.28, 174.77)] }]);
  assert.equal(f.length, 1);
  assert.equal(f[0].lines.length, 0);
  assert.deepEqual(f[0].points, [[-41.28, 174.77]]);
  assert.equal(f[0].markers[0].name, "Welly");
});

test("plusieurs jours : ordre chronologique, itinéraire routier ou lignes droites, traces Coros", () => {
  const frames = buildFrames(
    [
      { date: "2026-11-19", title: "C", places: [place("a", 1, 1), place("b", 2, 2)], route: { points: [[1, 1], [1.5, 1.5], [2, 2]] } },
      { date: "2026-11-17", title: "A", places: [place("x", 0, 0), place("y", 1, 0)] }, // pas de route calculée
      { date: "2026-11-18", title: "B", places: [place("z", 5, 5), place("w", 6, 6)], routeMode: "none" }, // sans trait
    ],
    [{ date: "2026-11-20", track: [[3, 3], [3.1, 3.1]] }, { date: "2026-11-19", track: [[1, 1], [1.2, 1.2]] }]
  );
  assert.deepEqual(frames.map((f) => f.date), ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
  assert.deepEqual(frames[0].lines.map((l) => [l.kind, l.routed]), [["road", false]]);
  assert.equal(frames[1].lines.length, 0);
  assert.deepEqual(frames[2].lines.map((l) => [l.kind, l.routed]), [["road", true], ["run", true]]);
  assert.equal(frames[3].title, ""); // course seule : pas de titre, mais une image
  assert.equal(frames[3].markers.length, 0);
});
