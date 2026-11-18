import test from "node:test";
import assert from "node:assert/strict";
import { renderDayArticle, dayLine } from "../public/js/dayview.js";

const K1 = "11111111-2222-3333-4444-555555555555.jpg";
const K2 = "22222222-2222-3333-4444-555555555555.jpg";
const K3 = "33333333-2222-3333-4444-555555555555.webm";
const entry = {
  date: "2026-11-18",
  title: `Wellington <b>"vent"</b>`,
  text: "Un **gras** et *italique*\n\n- liste\n\n[lien](https://exemple.org) <script>alert(1)</script>",
  photos: [{ key: K1, thumb: K1, caption: "Libre" }, { key: K2, thumb: K2, caption: "À l'étape", placeId: "p1" }],
  audios: [{ key: K3, label: "Note" }],
  videos: [{ url: "https://youtu.be/abcdefghijk", title: "Clip" }],
  places: [{ id: "p1", name: "Te Papa", lat: -41.29, lng: 174.78, time: "10:30", note: "Musée" }],
  routeMode: "drive",
};

test("rendu public : texte, photos libres puis photos d'étape, audio, vidéo, étape, mini-carte", () => {
  const h = renderDayArticle(entry, []);
  assert.match(h, /<h2>Wellington &lt;b&gt;&quot;vent&quot;&lt;\/b&gt;<\/h2>/);
  assert.match(h, /<strong>gras<\/strong>/);
  assert.ok(h.includes('<li>liste</li>') && h.includes('href="https://exemple.org"'));
  assert.ok(!h.includes("<script>"));
  const gallery = h.slice(h.indexOf('<div class="gallery">'), h.indexOf('<div class="block">'));
  assert.ok(gallery.includes(K1) && !gallery.includes(K2)); // la photo rattachée à une étape n'est pas dans la galerie libre
  assert.ok(h.includes('class="gallery small"') && h.includes(K2)); // elle est sous son étape
  assert.ok(h.includes("🎙 Note") && h.includes("youtube-nocookie.com/embed/abcdefghijk"));
  assert.ok(h.includes('class="pin">1</span>') && h.includes("Te Papa") && h.includes("10:30") && h.includes("Musée"));
  assert.ok(h.includes('id="minimap"'));
  assert.ok(!/comments|sedit|Modifier/.test(h)); // ni commentaires, ni bouton d'admin
});

test("jour vide et jour de course seule", () => {
  assert.match(renderDayArticle({ date: "2026-11-18" }, []), /<h2>Sans titre<\/h2>/);
  const run = renderDayArticle({ date: "2026-11-18", synthetic: true }, [{ distanceKm: 10.5, durationSec: 3600, elevGain: 80, track: [[0, 0], [1, 1]] }]);
  assert.match(run, /Course à pied · 10,5 km/);
  assert.ok(run.includes('class="trackmap"') && run.includes("Dénivelé +"));
  assert.ok(!run.includes('id="minimap"'));
});

test("extra ajouté en fin d'article ; dayLine : route calculée, lignes droites, désactivé", () => {
  assert.ok(renderDayArticle(entry, [], { extra: "<i>fin</i>" }).trim().endsWith("<i>fin</i>"));
  const two = [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }];
  assert.deepEqual(dayLine({ places: two, routeMode: "drive" }), { pts: [[0, 0], [1, 1]], routed: false });
  assert.equal(dayLine({ places: two, routeMode: "drive", route: { points: [[0, 0], [0.5, 0.5], [1, 1]] } }).routed, true);
  assert.equal(dayLine({ places: two, routeMode: "none" }), null);
  assert.equal(dayLine({ places: [two[0]] }), null);
});
