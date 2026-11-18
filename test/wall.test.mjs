import test from "node:test";
import assert from "node:assert/strict";
import { buildWall } from "../public/js/wall.js";

const P = (k) => ({ key: k + ".jpg", thumb: k + "-t.jpg", caption: "" });

test("toutes les photos, dans l'ordre chronologique, indices cohérents avec la liste à plat", () => {
  const { groups, list } = buildWall([
    { date: "2026-11-19", title: "B", photos: [P("c")] },
    { date: "2026-11-17", title: "A", photos: [P("a1"), P("a2")] },
    { date: "2026-11-18", title: "sans photo", photos: [] },
    { date: "2026-11-20", photos: [P("d1"), P("d2"), P("d3")] },
  ]);
  assert.deepEqual(groups.map((g) => g.date), ["2026-11-17", "2026-11-19", "2026-11-20"]);
  assert.equal(list.length, 6);
  assert.deepEqual(list.map((p) => p.key), ["a1.jpg", "a2.jpg", "c.jpg", "d1.jpg", "d2.jpg", "d3.jpg"]);
  for (const g of groups) for (const { photo, index } of g.photos) {
    assert.equal(list[index].key, photo.key);
    assert.equal(list[index].date, g.date); // « Voir le jour » mène au bon jour
  }
  assert.equal(groups[2].title, "");
});

test("aucune photo / entrées invalides", () => {
  assert.deepEqual(buildWall([]), { groups: [], list: [] });
  assert.deepEqual(buildWall([null, { date: "2026-11-17" }]), { groups: [], list: [] });
});
