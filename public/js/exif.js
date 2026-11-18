// Lecture de l'heure et de la position d'une photo (EXIF), JPEG et HEIC/HEIF, sans dépendance.
// Utilisé avant le redimensionnement : la version envoyée au serveur n'a plus aucune métadonnée.
// Tout est tolérant : un fichier illisible ou sans EXIF donne simplement {}.

const MAX_EXIF = 1 << 20; // un bloc EXIF plus gros que 1 Mo est ignoré
const HEAD = 1 << 20; // octets lus en tête de fichier pour trouver le bloc

const ascii = (dv, o, n) => {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(o + i));
  return s;
};
const uintN = (dv, o, n) => {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + dv.getUint8(o + i);
  return v;
};

/** Position du bloc TIFF d'un JPEG : { tiffStart, end } (positions dans le fichier) ou null. */
function locateInJpeg(dv) {
  let pos = 2;
  while (pos + 4 <= dv.byteLength) {
    if (dv.getUint8(pos) !== 0xff) return null;
    const marker = dv.getUint8(pos + 1);
    if (marker === 0xff) { pos++; continue; } // octets de remplissage
    if (marker === 0xda || marker === 0xd9) return null; // début des données image : plus d'en-têtes
    const len = dv.getUint16(pos + 2);
    if (marker === 0xe1 && len >= 8 && ascii(dv, pos + 4, 6) === "Exif\0\0") return { tiffStart: pos + 10, end: pos + 2 + len };
    pos += 2 + len;
  }
  return null;
}

/** Position du bloc TIFF d'un HEIC/HEIF : on lit ftyp, meta, iinf (id de l'élément « Exif ») puis iloc (où il se trouve). */
function locateInHeic(dv) {
  // boîtes ISO-BMFF dans [start, end) ; renvoie [{type, start (début du contenu), end}]
  const boxes = (start, end) => {
    const out = [];
    let p = start;
    while (p + 8 <= end) {
      let size = dv.getUint32(p);
      const type = ascii(dv, p + 4, 4);
      let head = 8;
      if (size === 1) { size = uintN(dv, p + 8, 8); head = 16; }
      else if (size === 0) size = end - p;
      if (size < head) break;
      out.push({ type, start: p + head, end: Math.min(p + size, end) }); // une boîte coupée par la fin du tampon est tronquée
      if (p + size > end) break;
      p += size;
    }
    return out;
  };
  const top = boxes(0, dv.byteLength);
  if (top[0]?.type !== "ftyp") return null;
  const meta = top.find((b) => b.type === "meta");
  if (!meta) return null;
  const inner = boxes(meta.start + 4, meta.end); // meta est une « full box » : 4 octets de version/drapeaux
  const iinf = inner.find((b) => b.type === "iinf");
  const iloc = inner.find((b) => b.type === "iloc");
  if (!iinf || !iloc) return null;

  const iinfVer = dv.getUint8(iinf.start);
  let p = iinf.start + 4 + (iinfVer === 0 ? 2 : 4);
  let exifId = null;
  for (const b of boxes(p, iinf.end)) {
    if (b.type !== "infe") continue;
    const v = dv.getUint8(b.start);
    if (v < 2) continue;
    const idSize = v === 2 ? 2 : 4;
    const id = uintN(dv, b.start + 4, idSize);
    if (ascii(dv, b.start + 4 + idSize + 2, 4) === "Exif") { exifId = id; break; }
  }
  if (exifId === null) return null;

  const ver = dv.getUint8(iloc.start);
  const sizes = dv.getUint8(iloc.start + 4);
  const sizes2 = dv.getUint8(iloc.start + 5);
  const offSize = sizes >> 4, lenSize = sizes & 15, baseSize = sizes2 >> 4;
  const idxSize = ver === 1 || ver === 2 ? sizes2 & 15 : 0;
  p = iloc.start + 6;
  const count = ver < 2 ? dv.getUint16(p) : dv.getUint32(p);
  p += ver < 2 ? 2 : 4;
  for (let i = 0; i < count; i++) {
    const id = ver < 2 ? dv.getUint16(p) : dv.getUint32(p);
    p += ver < 2 ? 2 : 4;
    let method = 0;
    if (ver === 1 || ver === 2) { method = dv.getUint16(p) & 15; p += 2; }
    p += 2; // data_reference_index
    const base = uintN(dv, p, baseSize);
    p += baseSize;
    const extents = dv.getUint16(p);
    p += 2;
    for (let j = 0; j < extents; j++) {
      p += idxSize;
      const off = uintN(dv, p, offSize);
      const len = uintN(dv, p + offSize, lenSize);
      p += offSize + lenSize;
      if (id === exifId && j === 0 && method === 0 && len > 8) {
        // l'élément commence par un entier : distance entre lui et l'en-tête TIFF
        const at = base + off;
        if (at + 4 > dv.byteLength) return { need: { start: at, end: at + Math.min(len, MAX_EXIF) } };
        return { tiffStart: at + 4 + dv.getUint32(at), end: at + len };
      }
    }
  }
  return null;
}

/** Trouve le bloc TIFF d'un fichier (début de fichier suffisant). */
export function locateExif(buf) {
  const dv = new DataView(buf);
  try {
    if (dv.byteLength > 4 && dv.getUint16(0) === 0xffd8) return locateInJpeg(dv);
    if (dv.byteLength > 12) return locateInHeic(dv);
  } catch { /* fichier tronqué ou abîmé */ }
  return null;
}

/** Lit un bloc TIFF (en-tête « II » ou « MM » en position `base`) : { ts, date, time, lat, lng }, sans les champs absents. */
export function parseTiff(buf, base = 0) {
  const dv = new DataView(buf);
  try {
    const bo = dv.getUint16(base);
    if (bo !== 0x4949 && bo !== 0x4d4d) return {};
    const le = bo === 0x4949;
    if (dv.getUint16(base + 2, le) !== 42) return {};
    const u16 = (o) => dv.getUint16(base + o, le);
    const u32 = (o) => dv.getUint32(base + o, le);
    const ifd = (off) => {
      const map = new Map();
      const n = u16(off);
      if (n > 200) return map;
      for (let i = 0; i < n; i++) {
        const e = off + 2 + i * 12;
        map.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 });
      }
      return map;
    };
    const dataAt = (en, unit) => (unit * en.count <= 4 ? en.at : u32(en.at));
    const text = (en) => {
      const o = dataAt(en, 1);
      return ascii(dv, base + o, Math.min(en.count, 64)).replace(/\0.*$/s, "");
    };
    const rationals = (en, n) => {
      if (en.type !== 5 || en.count < n) return null;
      const o = dataAt(en, 8);
      const out = [];
      for (let i = 0; i < n; i++) {
        const den = u32(o + i * 8 + 4);
        out.push(den ? u32(o + i * 8) / den : NaN);
      }
      return out;
    };

    const ifd0 = ifd(u32(4));
    const res = {};

    const exif = ifd0.get(0x8769) ? ifd(u32(ifd0.get(0x8769).at)) : new Map();
    const stamp = [exif.get(0x9003), exif.get(0x9004), ifd0.get(0x0132)].find((en) => en?.type === 2);
    const m = stamp && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(text(stamp));
    if (m && m[1] !== "0000") {
      res.date = `${m[1]}-${m[2]}-${m[3]}`;
      res.time = `${m[4]}:${m[5]}`;
      res.ts = `${res.date}T${m[4]}:${m[5]}:${m[6]}`; // heure locale de la prise de vue : sert à trier, pas à convertir
    }

    const gps = ifd0.get(0x8825) ? ifd(u32(ifd0.get(0x8825).at)) : null;
    if (gps) {
      const dms = (v) => (v && v.every(Number.isFinite) ? v[0] + v[1] / 60 + v[2] / 3600 : null);
      let lat = gps.get(2) ? dms(rationals(gps.get(2), 3)) : null;
      let lng = gps.get(4) ? dms(rationals(gps.get(4), 3)) : null;
      if (lat !== null && lng !== null) {
        if (gps.get(1) && text(gps.get(1)).toUpperCase().startsWith("S")) lat = -lat;
        if (gps.get(3) && text(gps.get(3)).toUpperCase().startsWith("W")) lng = -lng;
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) {
          res.lat = lat;
          res.lng = lng;
        }
      }
    }
    return res;
  } catch {
    return {};
  }
}

/** Version synchrone pour un tampon qui contient tout le bloc EXIF (tests, petits fichiers). */
export function parseExif(buf) {
  const loc = locateExif(buf);
  return loc?.tiffStart != null ? parseTiff(buf, loc.tiffStart) : {};
}

/** Heure et position d'un fichier image (File ou Blob) ; {} si rien de lisible. Ne lève jamais d'exception. */
export async function readPhotoMeta(file) {
  try {
    const head = await file.slice(0, HEAD).arrayBuffer();
    let loc = locateExif(head);
    if (loc?.need) {
      // l'élément EXIF d'un HEIC peut se trouver après l'en-tête lu : on va le chercher
      const buf = await file.slice(loc.need.start, loc.need.end).arrayBuffer();
      const dv = new DataView(buf);
      const tiff = 4 + dv.getUint32(0);
      return buf.byteLength > tiff + 8 ? parseTiff(buf, tiff) : {};
    }
    if (!loc?.tiffStart || loc.end - loc.tiffStart > MAX_EXIF) return {};
    if (loc.end <= head.byteLength) return parseTiff(head, loc.tiffStart);
    return parseTiff(await file.slice(loc.tiffStart, loc.end).arrayBuffer(), 0);
  } catch {
    return {};
  }
}
