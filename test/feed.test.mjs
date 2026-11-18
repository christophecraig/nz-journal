import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { memoryStore, loadApi } from "./helpers.mjs";
import { buildRss, xmlEsc, isWritten } from "../netlify/lib/feed.mjs";

const ORIGIN = "https://site.test";
const entry = (date, o = {}) => ({ date, title: "T " + date, text: "Texte", photos: [], updatedAt: "2026-11-20T01:00:00.000Z", ...o });

test("xmlEsc : entités et caractères de contrôle", () => {
  assert.equal(xmlEsc(`a & b < c > "d" 'e'`), "a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;");
  assert.equal(xmlEsc("ok\u0000\u0008\u000b\u001fok"), "okok");
  assert.equal(xmlEsc("😀 é"), "😀 é");
});

test("isWritten : titre ou récit, pas de brouillon", () => {
  assert.ok(isWritten(entry("2026-11-20")));
  assert.ok(isWritten(entry("2026-11-20", { title: "", text: "x" })));
  assert.ok(!isWritten(entry("2026-11-20", { title: " ", text: "" })));
  assert.ok(!isWritten(entry("2026-11-20", { draft: true })));
  assert.ok(!isWritten(null));
});

test("buildRss : ordre décroissant, éléments, photo, échappement", () => {
  const xml = buildRss([
    entry("2026-11-18", { title: `Wellington <b>&</b> "co"`, text: "**Gras** & <script>alert(1)</script>", photos: [{ key: "k.jpg", thumb: "t.jpg" }] }),
    entry("2026-11-20"),
    entry("2026-11-19", { draft: true, title: "SECRET" }),
    entry("2026-11-17", { title: "", text: "" }),
  ], ORIGIN);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(!xml.includes("SECRET") && !xml.includes("2026-11-17"));
  assert.ok(xml.indexOf("/jour/2026-11-20") < xml.indexOf("/jour/2026-11-18")); // récent d'abord
  assert.equal((xml.match(/<item>/g) || []).length, 2);
  assert.match(xml, /<title>Wellington &lt;b&gt;&amp;&lt;\/b&gt; &quot;co&quot;<\/title>/);
  assert.ok(!xml.includes("<script>") && !xml.includes("<b>"));
  assert.match(xml, /<guid isPermaLink="true">https:\/\/site\.test\/jour\/2026-11-18<\/guid>/);
  assert.match(xml, /<pubDate>Wed, 18 Nov 2026 12:00:00 GMT<\/pubDate>/);
  assert.match(xml, /&lt;img src=&quot;https:\/\/site\.test\/api\/media\/t\.jpg&quot;/);
  assert.match(xml, /<lastBuildDate>Fri, 20 Nov 2026 01:00:00 GMT<\/lastBuildDate>/);
});

test("buildRss : sans entrée, flux valide et vide ; 30 éléments max", () => {
  const empty = buildRss([], ORIGIN);
  assert.ok(empty.includes("<channel>") && !empty.includes("<item>") && !empty.includes("lastBuildDate"));
  const many = Array.from({ length: 45 }, (_, i) => entry(`2026-12-${String((i % 28) + 1).padStart(2, "0")}`, { title: "j" + i }));
  assert.equal((buildRss(many, ORIGIN).match(/<item>/g) || []).length, 30);
});

const store = memoryStore();
globalThis.__CARNET_STORE__ = store;
const { default: feed, config } = await loadApi("functions/feed.mjs");

test("fonction /rss.xml : type, cache, brouillon exclu", async () => {
  assert.equal(config.path, "/rss.xml");
  await store.setJSON("entries/2026-11-18", entry("2026-11-18"));
  await store.setJSON("entries/2026-11-19", entry("2026-11-19", { draft: true, title: "SECRET" }));
  const r = await feed(new Request(ORIGIN + "/rss.xml"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^application\/rss\+xml/);
  assert.match(r.headers.get("cache-control"), /max-age=300/);
  const xml = await r.text();
  assert.ok(xml.includes("2026-11-18") && !xml.includes("SECRET"));
});

test("fonction /rss.xml : store en panne → 503", async () => {
  const saved = globalThis.__CARNET_STORE__;
  globalThis.__CARNET_STORE__ = { list: async () => { throw new Error("boom"); } };
  const r = await feed(new Request(ORIGIN + "/rss.xml"));
  globalThis.__CARNET_STORE__ = saved;
  assert.equal(r.status, 503);
});

test("accueil : lien alternate RSS et lien en pied de page", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(html.includes('rel="alternate" type="application/rss+xml"') && html.includes('href="/rss.xml"'));
});
