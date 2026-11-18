import test from "node:test";
import assert from "node:assert/strict";
import { parseExif, parseTiff, readPhotoMeta } from "../public/js/exif.js";
import { distanceM, nearestWithin, clusterPhotos } from "../public/js/photogeo.js";

/* ----- Fabrique de fichiers : bloc TIFF, JPEG et HEIC minimaux ----- */

const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const u16 = (n) => Uint8Array.of(n >> 8, n & 255);
const u32 = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

/** Bloc TIFF avec date de prise de vue et position GPS. */
function tiff({ le = true, date = "2026:11:18 14:32:05", lat = [41, 17, 11.4], latRef = "S", lng = [174, 46, 34], lngRef = "E", gps = true } = {}) {
  const buf = new ArrayBuffer(400);
  const dv = new DataView(buf);
  let end = 0;
  const w16 = (o, v) => { dv.setUint16(o, v, le); end = Math.max(end, o + 2); };
  const w32 = (o, v) => { dv.setUint32(o, v, le); end = Math.max(end, o + 4); };
  const ascii = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); end = Math.max(end, o + s.length); };
  ascii(0, le ? "II" : "MM");
  w16(2, 42);
  w32(4, 8);
  // IFD0 en 8 : ExifIFD (38) et, si demandé, GPS (56)
  w16(8, gps ? 2 : 1);
  w16(10, 0x8769); w16(12, 4); w32(14, 1); w32(18, 38);
  if (gps) { w16(22, 0x8825); w16(24, 4); w32(26, 1); w32(30, 56); }
  w32(gps ? 34 : 22, 0);
  // ExifIFD en 38 : DateTimeOriginal -> texte en 110
  w16(38, 1);
  w16(40, 0x9003); w16(42, 2); w32(44, 20); w32(48, 110); w32(52, 0);
  ascii(110, date);
  dv.setUint8(110 + date.length, 0);
  if (gps) {
    // GPS IFD en 56 : réf. lat, lat (130), réf. lng, lng (154)
    w16(56, 4);
    w16(58, 1); w16(60, 2); w32(62, 2); ascii(66, latRef);
    w16(70, 2); w16(72, 5); w32(74, 3); w32(78, 130);
    w16(82, 3); w16(84, 2); w32(86, 2); ascii(90, lngRef);
    w16(94, 4); w16(96, 5); w32(98, 3); w32(102, 154);
    w32(106, 0);
    const rat = (o, [d, m, s]) => { w32(o, d); w32(o + 4, 1); w32(o + 8, m); w32(o + 12, 1); w32(o + 16, Math.round(s * 100)); w32(o + 20, 100); };
    rat(130, lat);
    rat(154, lng);
  }
  return new Uint8Array(buf, 0, Math.max(end, 178));
}

const jpeg = (tiffBytes, { app0 = true } = {}) =>
  cat(
    u16(0xffd8),
    app0 ? cat(u16(0xffe0), u16(16), bytes("JFIF\0"), new Uint8Array(9)) : new Uint8Array(0),
    tiffBytes ? cat(u16(0xffe1), u16(2 + 6 + tiffBytes.length), bytes("Exif\0\0"), tiffBytes) : new Uint8Array(0),
    u16(0xffda), u16(2)
  );

const box = (type, ...payload) => {
  const body = cat(...payload);
  return cat(u32(8 + body.length), bytes(type), body);
};
const infe = (id, type) => box("infe", Uint8Array.of(2, 0, 0, 0), u16(id), u16(0), bytes(type), Uint8Array.of(0));

/** HEIC : ftyp + meta (iinf, iloc) + mdat ; `padding` octets d'image avant l'élément EXIF dans mdat. */
function heic(tiffBytes, { padding = 0 } = {}) {
  const exifItem = cat(u32(6), bytes("Exif\0\0"), tiffBytes);
  const build = (exifOffset) => {
    const ftyp = box("ftyp", bytes("heic"), u32(0), bytes("mif1"), bytes("heic"));
    const item = (id, off, len) => cat(u16(id), u16(0), u16(0), u16(1), u32(off), u32(len));
    const meta = box(
      "meta", u32(0),
      box("iinf", u32(0), u16(2), infe(1, "hvc1"), infe(2, "Exif")),
      box("iloc", Uint8Array.of(1, 0, 0, 0), Uint8Array.of(0x44, 0x00), u16(2), item(1, 999999, 100), item(2, exifOffset, exifItem.length))
    );
    return { ftyp, meta };
  };
  const { ftyp, meta } = build(0);
  const exifOffset = ftyp.length + meta.length + 8 + padding;
  const real = build(exifOffset);
  return cat(real.ftyp, real.meta, box("mdat", new Uint8Array(padding), exifItem));
}

const buf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/* ----- EXIF ----- */

test("JPEG : date, heure et position (hémisphère sud, est), ordre des octets II et MM", () => {
  for (const le of [true, false]) {
    const m = parseExif(buf(jpeg(tiff({ le }))));
    assert.deepEqual([m.date, m.time, m.ts], ["2026-11-18", "14:32", "2026-11-18T14:32:05"]);
    near(m.lat, -(41 + 17 / 60 + 11.4 / 3600));
    near(m.lng, 174 + 46 / 60 + 34 / 3600);
  }
});

test("JPEG : hémisphère ouest, et sans GPS la date reste lue", () => {
  const w = parseExif(buf(jpeg(tiff({ latRef: "N", lngRef: "W" }))));
  assert.ok(w.lat > 0 && w.lng < 0);
  const nogps = parseExif(buf(jpeg(tiff({ gps: false }))));
  assert.deepEqual([nogps.time, nogps.lat, nogps.lng], ["14:32", undefined, undefined]);
});

test("HEIC : même résultat, bloc EXIF trouvé via iinf et iloc", () => {
  const m = parseExif(buf(heic(tiff())));
  assert.deepEqual([m.date, m.time], ["2026-11-18", "14:32"]);
  near(m.lat, -41.2865, 1e-3);
  near(m.lng, 174.7761, 1e-3);
});

test("fichiers sans EXIF, vides, tronqués ou quelconques : {} sans exception", () => {
  assert.deepEqual(parseExif(buf(jpeg(null))), {});
  assert.deepEqual(parseExif(new ArrayBuffer(0)), {});
  assert.deepEqual(parseExif(buf(bytes("pas une image du tout, juste du texte"))), {});
  const j = jpeg(tiff());
  assert.deepEqual(parseExif(buf(j.slice(0, 30))), {});
  assert.deepEqual(parseTiff(buf(bytes("XXXXXXXXXXXX"))), {});
  assert.deepEqual(parseExif(buf(heic(tiff()).slice(0, 60))), {});
});

test("position 0,0 ou date 0000 ignorées (appareils sans fix)", () => {
  const zero = parseExif(buf(jpeg(tiff({ lat: [0, 0, 0], lng: [0, 0, 0] }))));
  assert.equal(zero.lat, undefined);
  const nodate = parseExif(buf(jpeg(tiff({ date: "0000:00:00 00:00:00" }))));
  assert.equal(nodate.ts, undefined);
});

test("readPhotoMeta : Blob JPEG, Blob HEIC, et HEIC dont l'EXIF est au-delà du début de fichier", async () => {
  const j = await readPhotoMeta(new Blob([jpeg(tiff())]));
  assert.equal(j.time, "14:32");
  const h = await readPhotoMeta(new Blob([heic(tiff())]));
  near(h.lat, -41.2865, 1e-3);
  const far = await readPhotoMeta(new Blob([heic(tiff(), { padding: 1.3 * 1024 * 1024 })]));
  assert.deepEqual([far.time, Math.round(far.lng)], ["14:32", 175]);
  assert.deepEqual(await readPhotoMeta(new Blob(["rien"])), {});
  assert.deepEqual(await readPhotoMeta({ slice() { throw new Error("boum"); } }), {});
});

/* ----- Géographie ----- */

test("distanceM : Wellington – Auckland ≈ 493 km ; nearestWithin respecte le rayon", () => {
  const wel = { lat: -41.2865, lng: 174.7762 };
  const akl = { lat: -36.8485, lng: 174.7633 };
  near(distanceM(wel, akl) / 1000, 493, 5);
  const places = [{ id: "a", ...wel }, { id: "b", ...akl }];
  assert.equal(nearestWithin(places, { lat: -41.2870, lng: 174.7770 })?.id, "a");
  assert.equal(nearestWithin(places, { lat: -39, lng: 175 }), null);
  assert.equal(nearestWithin([], wel), null);
  assert.equal(nearestWithin([{ id: "x", lat: NaN, lng: 0 }], wel), null);
});

test("clusterPhotos : lieux regroupés dans l'ordre de l'heure, centre moyen, heure de la 1re photo", () => {
  const mk = (lat, lng, ts, ref) => ({ lat, lng, ts, time: ts.slice(11, 16), ref });
  const items = [
    mk(-41.2900, 174.7800, "2026-11-18T15:00:00", "c"), // même endroit que « a », plus tard
    mk(-36.8485, 174.7633, "2026-11-18T18:00:00", "d"), // Auckland
    mk(-41.2865, 174.7762, "2026-11-18T09:10:00", "a"),
    mk(-41.2867, 174.7765, "2026-11-18T09:20:00", "b"),
  ];
  const g = clusterPhotos(items, 600);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].items.map((x) => x.ref), ["a", "b", "c"]);
  assert.equal(g[0].time, "09:10");
  assert.equal(g[1].time, "18:00");
  near(g[0].lat, (-41.2865 - 41.2867 - 41.29) / 3, 1e-6);
  assert.deepEqual(clusterPhotos([]), []);
});
