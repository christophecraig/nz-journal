// Copie Leaflet (dépendance npm épinglée) dans public/vendor/leaflet pour le servir depuis le site lui-même.
// Lancé par Netlify au déploiement (build.command). Ne casse jamais le déploiement : si la copie échoue,
// le front retombe sur le CDN unpkg (voir loadLeaflet dans public/js/common.js).
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = ["leaflet.js", "leaflet.css", "images"];

export function vendorLeaflet(dist, dest) {
  if (!existsSync(join(dist, "leaflet.js")) || !existsSync(join(dist, "leaflet.css"))) {
    throw new Error(`Leaflet introuvable dans ${dist}`);
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const f of FILES) if (existsSync(join(dist, f))) cpSync(join(dist, f), join(dest, f), { recursive: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    vendorLeaflet(join(root, "node_modules", "leaflet", "dist"), join(root, "public", "vendor", "leaflet"));
    console.log("Leaflet copié dans public/vendor/leaflet");
  } catch (e) {
    console.warn("⚠ " + e.message + " : le site utilisera le CDN unpkg en secours.");
  }
}
