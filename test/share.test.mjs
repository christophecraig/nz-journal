import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { memoryStore, loadApi } from "./helpers.mjs";
import { plainSnippet, dayMeta, metaTags, injectHead, escAttr, isRealDate } from "../netlify/lib/share.mjs";

const ORIGIN = "https://site.test";
const INDEX = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("plainSnippet : Markdown retiré, espaces compactés, troncature propre", () => {
  assert.equal(plainSnippet("## Titre\n\nUn **gras**, du *italique* et [un lien](https://x.test/a).\n- point"), "Titre Un gras, du italique et un lien. point");
  const long = "mot ".repeat(100);
  const s = plainSnippet(long, 150);
  assert.ok(Array.from(s).length <= 151 && s.endsWith("…") && !s.includes("  "));
  assert.equal(plainSnippet("😀".repeat(200), 10), "😀".repeat(10) + "…"); // pas de caractère coupé en deux
  assert.equal(plainSnippet(undefined), "");
});

test("escAttr : échappement complet", () => {
  assert.equal(escAttr(`"><script>alert('x')</script>&`), "&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;");
});

test("dayMeta : titre, résumé, première miniature ; repli sans photo / sans titre", () => {
  const m = dayMeta({ date: "2026-11-18", title: "Vers Wellington", text: "Départ **tôt** ce matin.", photos: [{ key: "a.jpg", thumb: "t.jpg" }, { key: "b.jpg", thumb: "b.jpg" }] }, ORIGIN);
  assert.equal(m.title, "Vers Wellington · Carnet de bord NZ");
  assert.equal(m.description, "Départ tôt ce matin.");
  assert.equal(m.url, `${ORIGIN}/jour/2026-11-18`);
  assert.equal(m.image, `${ORIGIN}/api/media/t.jpg`);
  const bare = dayMeta({ date: "2026-11-18", title: "", text: "", photos: [] }, ORIGIN);
  assert.match(bare.title, /^Mercredi 18 novembre 2026 · /);
  assert.equal(bare.image, `${ORIGIN}/og-image.png`);
  assert.equal(dayMeta(null, ORIGIN), null);
  assert.equal(dayMeta({ date: "2026-13-45" }, ORIGIN), null);
  assert.ok(isRealDate("2026-02-28") && !isRealDate("2026-02-30") && !isRealDate("x"));
});

test("injectHead : texte hostile échappé, balises génériques remplacées, reste du HTML intact", () => {
  const m = dayMeta({ date: "2026-11-18", title: `<img src=x onerror=alert(1)> "Hé"`, text: `</head><script>alert(1)</script> & co`, photos: [] }, ORIGIN);
  const out = injectHead(INDEX, m);
  assert.ok(!out.includes("<script>alert(1)"));
  assert.ok(!out.includes("<img src=x"));
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt; &quot;Hé&quot;/);
  assert.equal((out.match(/property="og:title"/g) || []).length, 1); // l'ancienne balise générique a disparu
  assert.equal((out.match(/<\/head>/g) || []).length, 1);
  // tout ce qui est hors <head> est strictement identique
  assert.equal(out.slice(out.indexOf("<body")), INDEX.slice(INDEX.indexOf("<body")));
  assert.match(metaTags(m), /twitter:card" content="summary_large_image"/);
});

test("injectHead : les « $ » du texte restent littéraux", () => {
  const m = dayMeta({ date: "2026-11-18", title: "Cher $& $1 $$", text: "50$ la nuit, $` et $'", photos: [] }, ORIGIN);
  const out = injectHead(INDEX, m);
  assert.ok(out.includes("<title>Cher $&amp; $1 $$ · Carnet de bord NZ</title>"));
  assert.ok(out.includes("50$ la nuit, $` et $&#39;"));
  assert.equal((out.match(/<\/head>/g) || []).length, 1);
});

test("accueil : balises de partage génériques présentes", () => {
  for (const p of ["og:title", "og:description", "og:image", "og:url"]) assert.ok(INDEX.includes(`property="${p}"`), p);
  assert.ok(INDEX.includes('name="twitter:card"'));
});

/* ---- Fonction /jour/* ---- */

const store = memoryStore();
globalThis.__CARNET_STORE__ = store;
const { default: dayPage, config } = await loadApi("functions/day-page.mjs");
const realFetch = globalThis.fetch;
const mockHome = (status = 200) => { globalThis.fetch = async () => new Response(INDEX, { status, headers: { "content-type": "text/html" } }); };
test.after(() => { globalThis.fetch = realFetch; });

test("fonction : chemin et jour existant", async () => {
  assert.equal(config.path, "/jour/*");
  mockHome();
  await store.setJSON("entries/2026-11-18", { date: "2026-11-18", title: "Wellington", text: "Une belle journée.", photos: [{ key: "k.jpg", thumb: "t.jpg" }] });
  const r = await dayPage(new Request(`${ORIGIN}/jour/2026-11-18`));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const html = await r.text();
  assert.match(html, /<title>Wellington · Carnet de bord NZ<\/title>/);
  assert.match(html, /og:image" content="https:\/\/site\.test\/api\/media\/t\.jpg"/);
  assert.match(html, /<script type="module" src="\/js\/app\.js">/); // le front est toujours là
});

test("fonction : jour inconnu, adresse invalide → page d'accueil telle quelle", async () => {
  mockHome();
  for (const p of ["/jour/2026-12-01", "/jour/n-importe-quoi", "/jour/2026-02-30"]) {
    const r = await dayPage(new Request(ORIGIN + p));
    assert.equal(r.status, 200);
    assert.equal(await r.text(), INDEX);
  }
});

test("fonction : accueil injoignable → redirection vers l'ancien format", async () => {
  mockHome(500);
  const r = await dayPage(new Request(`${ORIGIN}/jour/2026-11-18`));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), `${ORIGIN}/#2026-11-18`);
});

test("fonction : store en panne → la page est quand même servie", async () => {
  mockHome();
  const saved = globalThis.__CARNET_STORE__;
  globalThis.__CARNET_STORE__ = { get: async () => { throw new Error("boom"); } };
  const r = await dayPage(new Request(`${ORIGIN}/jour/2026-11-18`));
  globalThis.__CARNET_STORE__ = saved;
  assert.equal(r.status, 200);
  assert.equal(await r.text(), INDEX);
});
