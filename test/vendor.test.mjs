import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vendorLeaflet } from "../scripts/vendor-leaflet.mjs";

test("vendorLeaflet copie js, css et images", () => {
  const t = mkdtempSync(join(tmpdir(), "nzj-vendor-"));
  const dist = join(t, "dist");
  mkdirSync(join(dist, "images"), { recursive: true });
  writeFileSync(join(dist, "leaflet.js"), "js");
  writeFileSync(join(dist, "leaflet.css"), "css");
  writeFileSync(join(dist, "images", "marker-icon.png"), "png");
  const dest = join(t, "out");
  vendorLeaflet(dist, dest);
  assert.equal(readFileSync(join(dest, "leaflet.js"), "utf8"), "js");
  assert.ok(existsSync(join(dest, "images", "marker-icon.png")));
});

test("vendorLeaflet lève une erreur claire si Leaflet est absent", () => {
  assert.throws(() => vendorLeaflet(join(tmpdir(), "nzj-absent"), join(tmpdir(), "nzj-out")), /introuvable/);
});
