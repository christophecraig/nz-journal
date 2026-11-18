import test from "node:test";
import assert from "node:assert/strict";
import { countNew, newestDate } from "../public/js/recent.js";

const rows = [
  { id: "1", created_at: "2026-11-19T01:00:00.123456+00:00" },
  { id: "2", created_at: "2026-11-18T10:00:00+00:00" },
  { id: "3", created_at: "n'importe quoi" },
];

test("countNew : après la dernière visite ; tout si jamais vu ; dates illisibles ignorées", () => {
  assert.equal(countNew(rows, "2026-11-19T00:00:00.000Z"), 1);
  assert.equal(countNew(rows, "2026-11-17T00:00:00.000Z"), 2);
  assert.equal(countNew(rows, ""), 2);
  assert.equal(countNew(rows, "2026-11-20T00:00:00.000Z"), 0);
  assert.equal(countNew(undefined, "x"), 0);
});

test("newestDate : le plus récent, ou chaîne vide", () => {
  assert.equal(newestDate(rows), "2026-11-19T01:00:00.123456+00:00");
  assert.equal(newestDate([]), "");
});
