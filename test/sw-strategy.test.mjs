import test from "node:test";
import assert from "node:assert/strict";
import { pickStrategy } from "../public/js/sw-strategy.js";

const O = "https://site.test";
const pick = (path, extra = {}, origin = O) =>
  pickStrategy({ method: "GET", url: origin + path, hasAuthorization: false, hasRange: false, ...extra }, O);
const KEY = "0123456789abcdef0123456789abcdef0123";

test("jamais intercepté : Authorization, Range, méthodes non GET, tiers, requêtes avec paramètres", () => {
  assert.equal(pick("/api/entries", { hasAuthorization: true }), "ignore"); // admin : brouillons
  assert.equal(pick("/js/app.js", { hasAuthorization: true }), "ignore");
  assert.equal(pick(`/api/media/${KEY.slice(0, 32)}-abcd.mp3`, { hasRange: true }), "ignore"); // seek audio
  assert.equal(pick("/api/entries", { method: "POST" }), "ignore");
  assert.equal(pick("/api/entries/2026-11-20", { method: "PUT" }), "ignore");
  assert.equal(pick("/leaflet.js", {}, "https://unpkg.com"), "ignore");
  assert.equal(pick("/rest/v1/comments", {}, "https://x.supabase.co"), "ignore");
  assert.equal(pick("/?code=abc"), "ignore"); // retour OAuth
  assert.equal(pick("/admin?coros=ok"), "ignore");
});

test("jamais intercepté : admin, API privée, service worker, inconnu", () => {
  for (const p of ["/admin", "/admin/", "/admin.html", "/api/login", "/api/me", "/api/coros/status", "/api/geocode", "/api/comments/x", "/sw.js", "/rss.xml", "/n-importe-quoi"]) {
    assert.equal(pick(p), "ignore", p);
  }
});

test("photos : cache d'abord, uniquement pour une clé UUID.extension", () => {
  assert.equal(pick("/api/media/0123456789abcdef0123456789abcdef0123.jpg"), "media");
  assert.equal(pick("/api/media/pas-une-cle"), "ignore");
});

test("données publiques : réseau d'abord", () => {
  assert.equal(pick("/api/entries"), "data");
  assert.equal(pick("/api/activities"), "data");
});

test("pages et fichiers statiques : réseau d'abord", () => {
  for (const p of ["/", "/confidentialite", "/conditions", "/jour/2026-11-20", "/jour/2026-11-20/", "/js/app.js", "/style.css", "/vendor/leaflet/leaflet.js", "/icons/icon-192.png", "/manifest.webmanifest", "/favicon.svg"]) {
    assert.equal(pick(p), "shell", p);
  }
  assert.equal(pick("/jour/pas-une-date"), "ignore");
});
