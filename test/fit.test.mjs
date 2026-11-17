import test from "node:test";
import assert from "node:assert/strict";
import { decodeFitGps, simplifyTrack } from "../netlify/lib/fit.mjs";
import { buildFit } from "./helpers.mjs";

const pts = [[-41.2865, 174.7762], [-41.287, 174.777], [-41.2875, 174.7785]];

test("décode les points GPS (little endian)", () => {
  const r = decodeFitGps(buildFit(pts));
  assert.equal(r.recordCount, 3);
  assert.equal(r.points.length, 3);
  assert.ok(Math.abs(r.points[0][0] - -41.2865) < 1e-5);
  assert.ok(Math.abs(r.points[2][1] - 174.7785) < 1e-5);
});

test("décode en big endian et saute les champs développeur", () => {
  const r = decodeFitGps(buildFit(pts, { bigEndian: true, withDevField: true }));
  assert.equal(r.points.length, 3);
  assert.ok(Math.abs(r.points[1][1] - 174.777) < 1e-5);
});

test("ignore les valeurs GPS invalides", () => {
  const r = decodeFitGps(buildFit([[null, null], ...pts]));
  assert.equal(r.recordCount, 4);
  assert.equal(r.points.length, 3);
});

test("rejette un fichier qui n'est pas du FIT", () => {
  assert.throws(() => decodeFitGps(new Uint8Array(40)));
  assert.throws(() => decodeFitGps(new Uint8Array(3)));
});

test("simplifyTrack réduit à max points en gardant début et fin", () => {
  const big = Array.from({ length: 1000 }, (_, i) => [i / 1000, i / 500]);
  const s = simplifyTrack(big, 250);
  assert.equal(s.length, 250);
  assert.deepEqual(s[0], [0, 0]);
  assert.deepEqual(s.at(-1), [0.999, 1.998]);
  assert.equal(simplifyTrack(big.slice(0, 10), 250).length, 10);
});
