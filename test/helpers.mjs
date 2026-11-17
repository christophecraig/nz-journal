import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

/** Store en mémoire, même interface que celle utilisée de @netlify/blobs. */
export function memoryStore() {
  const m = new Map();
  return {
    m,
    async list({ prefix }) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
    async get(k, o) { const v = m.get(k); if (!v) return null; return o?.type === "json" ? JSON.parse(v.data) : v.data; },
    async getWithMetadata(k) { const v = m.get(k); return v ? { data: v.data, metadata: v.metadata } : null; },
    async setJSON(k, v) { m.set(k, { data: JSON.stringify(v) }); },
    async set(k, v, o) { m.set(k, { data: v, metadata: o?.metadata }); },
    async delete(k) { m.delete(k); },
  };
}

/** Copie le dossier netlify/ dans un répertoire temporaire avec un faux @netlify/blobs, pour tester sans npm install. */
export async function loadApi() {
  const root = join(fileURLToPath(new URL("..", import.meta.url)));
  const tmp = mkdtempSync(join(tmpdir(), "nzj-"));
  cpSync(join(root, "netlify"), join(tmp, "netlify"), { recursive: true });
  writeFileSync(join(tmp, "package.json"), '{"type":"module"}');
  const stub = join(tmp, "node_modules", "@netlify", "blobs");
  mkdirSync(stub, { recursive: true });
  writeFileSync(join(stub, "package.json"), '{"name":"@netlify/blobs","version":"0.0.0","main":"index.js","type":"module"}');
  writeFileSync(join(stub, "index.js"), 'export const getStore = () => { throw new Error("stub: utiliser globalThis.__CARNET_STORE__"); };');
  return import(pathToFileURL(join(tmp, "netlify", "functions", "api.mjs")).href);
}

/** Construit un petit fichier FIT valide (messages « record » avec lat/lng en semicercles). */
export function buildFit(points, { bigEndian = false, withDevField = false } = {}) {
  const deg2sc = (d) => Math.round((d * 2 ** 31) / 180);
  const body = [];
  const u16 = (n) => (bigEndian ? [(n >> 8) & 255, n & 255] : [n & 255, (n >> 8) & 255]);
  const i32 = (n) => {
    const b = Buffer.alloc(4);
    bigEndian ? b.writeInt32BE(n) : b.writeInt32LE(n);
    return [...b];
  };
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    bigEndian ? b.writeUInt32BE(n) : b.writeUInt32LE(n);
    return [...b];
  };
  // définition d'un message « file_id » (num 0) pour vérifier qu'on saute les autres messages
  body.push(0x41, 0, bigEndian ? 1 : 0, ...u16(0), 1, 0, 1, 0x00);
  body.push(0x01, 4); // données file_id : type = 4
  // définition de « record » (num 20) : timestamp(253,u32z), lat(0,sint32), lng(1,sint32), hr(3,uint8)
  const hasDev = withDevField ? 0x20 : 0;
  body.push(0x42 | hasDev, 0, bigEndian ? 1 : 0, ...u16(20), 4, 253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85, 3, 1, 0x02);
  if (withDevField) body.push(1, 0, 2, 0); // 1 champ développeur de 2 octets
  let t = 1000;
  for (const [lat, lng] of points) {
    body.push(0x02, ...u32(t++));
    body.push(...(lat === null ? i32(0x7fffffff) : i32(deg2sc(lat))), ...(lng === null ? i32(0x7fffffff) : i32(deg2sc(lng))), 140);
    if (withDevField) body.push(7, 7);
  }
  const header = Buffer.alloc(14);
  header[0] = 14;
  header[1] = 0x20;
  header.writeUInt16LE(2100, 2);
  header.writeUInt32LE(body.length, 4);
  header.write(".FIT", 8, "ascii");
  return new Uint8Array(Buffer.concat([header, Buffer.from(body), Buffer.from([0, 0])]));
}
