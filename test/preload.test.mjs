import test from "node:test";
import assert from "node:assert/strict";
import { takePreloaded } from "../public/js/common.js";

test("takePreloaded : renvoie la réponse une seule fois", async () => {
  const win = { __nzPre: { entries: Promise.resolve({ entries: [1] }) } };
  assert.deepEqual(await takePreloaded("entries", win), { entries: [1] });
  assert.equal(await takePreloaded("entries", win), null); // consommée : le chargement suivant sera frais
});

test("takePreloaded : null si absent, en échec ou vide", async () => {
  assert.equal(await takePreloaded("entries", {}), null);
  assert.equal(await takePreloaded("entries", undefined), null);
  assert.equal(await takePreloaded("x", { __nzPre: { x: Promise.reject(new Error("réseau")) } }), null);
  assert.equal(await takePreloaded("x", { __nzPre: { x: Promise.resolve(null) } }), null);
});
