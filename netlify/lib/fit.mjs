// Décodeur FIT minimal (protocole Garmin/ANT) : n'extrait que les points GPS des messages « record ».
// Aucune dépendance. Toute anomalie lève une exception : l'appelant décide d'ignorer le tracé.

const TYPE_SIZE = { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 1, 8: 4, 9: 8, 10: 1, 11: 2, 12: 4, 13: 1, 14: 8, 15: 8, 16: 8 };
const SEMICIRCLES_TO_DEG = 180 / 2 ** 31;
const MSG_RECORD = 20;
const FIELD_LAT = 0;
const FIELD_LNG = 1;

/**
 * @param {Uint8Array} buf contenu d'un fichier .fit
 * @returns {{ points: number[][], recordCount: number }} points = [[lat, lng], ...] en degrés
 */
export function decodeFitGps(buf) {
  if (!buf || buf.length < 14) throw new Error("Fichier FIT trop court");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerSize = buf[0];
  if (headerSize !== 12 && headerSize !== 14) throw new Error("En-tête FIT invalide");
  if (String.fromCharCode(buf[8], buf[9], buf[10], buf[11]) !== ".FIT") throw new Error("Signature .FIT absente");
  const dataEnd = Math.min(buf.length, headerSize + dv.getUint32(4, true));

  const defs = new Map(); // type local -> définition
  const points = [];
  let recordCount = 0;
  let pos = headerSize;

  const readData = (def) => {
    let lat = null;
    let lng = null;
    for (const f of def.fields) {
      if (def.gnum === MSG_RECORD && f.type === 5 && f.size === 4 && (f.num === FIELD_LAT || f.num === FIELD_LNG)) {
        const v = dv.getInt32(pos, def.little);
        if (v !== 0x7fffffff) {
          if (f.num === FIELD_LAT) lat = v * SEMICIRCLES_TO_DEG;
          else lng = v * SEMICIRCLES_TO_DEG;
        }
      }
      pos += f.size;
    }
    pos += def.devSize;
    if (def.gnum === MSG_RECORD) {
      recordCount++;
      if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) {
        points.push([lat, lng]);
      }
    }
  };

  while (pos < dataEnd) {
    const h = buf[pos++];
    if (h & 0x80) {
      // en-tête à horodatage compressé : message de données
      const def = defs.get((h >> 5) & 0x03);
      if (!def) throw new Error("Message de données sans définition");
      readData(def);
    } else if (h & 0x40) {
      // définition de message
      const hasDev = (h & 0x20) !== 0;
      const local = h & 0x0f;
      pos++; // réservé
      const little = buf[pos++] === 0;
      const gnum = dv.getUint16(pos, little);
      pos += 2;
      const nf = buf[pos++];
      const fields = [];
      for (let i = 0; i < nf; i++) {
        const type = buf[pos + 2] & 0x1f;
        fields.push({ num: buf[pos], size: buf[pos + 1], type });
        pos += 3;
      }
      let devSize = 0;
      if (hasDev) {
        const nd = buf[pos++];
        for (let i = 0; i < nd; i++) {
          devSize += buf[pos + 1];
          pos += 3;
        }
      }
      for (const f of fields) {
        if (f.size === 0 || (TYPE_SIZE[f.type] ?? 1) > f.size) {
          // champ de taille inattendue : on ne le lira jamais comme entier, on saute juste ses octets
          f.type = 13;
        }
      }
      defs.set(local, { gnum, little, fields, devSize });
    } else {
      const def = defs.get(h & 0x0f);
      if (!def) throw new Error("Message de données sans définition");
      readData(def);
    }
  }
  if (pos > buf.length) throw new Error("Fichier FIT tronqué");
  return { points, recordCount };
}

/** Réduit un tracé à ~max points (répartition régulière, premier et dernier conservés), arrondi à 5 décimales. */
export function simplifyTrack(points, max = 250) {
  if (points.length <= max) return points.map(([a, b]) => [round5(a), round5(b)]);
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    const [a, b] = points[Math.round(i * step)];
    out.push([round5(a), round5(b)]);
  }
  return out;
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;
