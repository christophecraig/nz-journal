// Rendu d'une fiche de jour, partagé entre la page publique (app.js) et l'aperçu de l'éditeur (editor.js).
import { esc, md, mediaUrl, videoEmbed, fmtLong, fmtDur, fmtPace, fmtKm, actLabel, actTitle, loadLeaflet, addTiles } from "./common.js";

/** Ligne à tracer pour un jour : itinéraire routier si calculé, sinon lignes droites entre les étapes (sauf si désactivé). */
export function dayLine(e) {
  const pl = e.places || [];
  if (pl.length < 2 || e.routeMode === "none") return null;
  if (e.route?.points?.length > 1) return { pts: e.route.points, routed: true };
  return { pts: pl.map((p) => [p.lat, p.lng]), routed: false };
}

/**
 * Contenu HTML de l'<article> d'un jour (sans commentaires ni boutons d'admin : `extra` est ajouté à la fin).
 * @param {object} e fiche (réelle ou synthétisée)
 * @param {object[]} acts courses Coros du jour
 */
export function renderDayArticle(e, acts = [], { extra = "" } = {}) {
  const placeIds = new Set((e.places || []).map((p) => p.id).filter(Boolean));
  const fig = (p, i) => `<figure data-i="${i}"><img loading="lazy" alt="${esc(p.caption || "Photo du jour")}" src="${mediaUrl(p.thumb || p.key)}">${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`;
  const photos = (e.photos || [])
    .map((p, i) => (p.placeId && placeIds.has(p.placeId) ? "" : fig(p, i)))
    .join("");
  const audios = (e.audios || [])
    .map((a) => `<div class="audio"><span>🎙 ${esc(a.label || "Note vocale")}</span><audio controls preload="none" src="${mediaUrl(a.key)}"></audio></div>`)
    .join("");
  const videos = (e.videos || [])
    .map((v) => `<div class="video">${v.title ? `<p class="vt">${esc(v.title)}</p>` : ""}${videoEmbed(v.url)}</div>`)
    .join("");
  const runs = acts
    .map((a, i) => {
      const stats = [
        ["Distance", a.distanceKm ? `${fmtKm(a.distanceKm)} km` : null],
        ["Durée", a.durationSec ? fmtDur(a.durationSec) : null],
        ["Allure", a.paceSecPerKm ? `${fmtPace(a.paceSecPerKm)} /km` : null],
        ["Dénivelé +", a.elevGain != null ? `${a.elevGain} m` : null],
        ["FC moy.", a.avgHr ? `${a.avgHr} bpm` : null],
        ["Cadence", a.cadence ? `${a.cadence} spm` : null],
      ].filter(([, v]) => v);
      return `<section class="run">
        <h3>🏃 ${esc(actLabel(a))}${a.location ? ` <span class="muted">· ${esc(a.location)}</span>` : ""}</h3>
        <dl class="stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
        ${a.track?.length > 1 ? `<div class="trackmap" data-i="${i}"></div>` : ""}
      </section>`;
    })
    .join("");
  const places = (e.places || [])
    .map((p, n) => {
      const ph = (e.photos || []).map((x, i) => (p.id && x.placeId === p.id ? fig(x, i) : "")).join("");
      return `<li class="stop">
        <span class="pin">${n + 1}</span>
        <div class="stopbody">
          <div class="stophead"><button type="button" class="stoplink" data-n="${n}" title="Voir sur la carte">${esc(p.name)}</button>${p.time ? ` <span class="muted">· ${esc(p.time)}</span>` : ""}${p.approx ? ` <span class="muted">· position approximative</span>` : ""}</div>
          ${p.note ? `<div class="stopnote">${esc(p.note)}</div>` : ""}
          ${ph ? `<div class="gallery small">${ph}</div>` : ""}
        </div>
      </li>`;
    })
    .join("");

  return `
        <p class="kicker">${esc(fmtLong(e.date))}</p>
        <h2>${esc(e.title || (acts.length ? acts.map(actTitle).join(" + ") : "Sans titre"))}</h2>
        ${e.text ? `<div class="prose">${md(e.text)}</div>` : ""}
        ${runs}
        ${photos ? `<div class="gallery">${photos}</div>` : ""}
        ${audios ? `<div class="block">${audios}</div>` : ""}
        ${videos ? `<div class="block">${videos}</div>` : ""}
        ${places ? `<div class="block"><div id="minimap"></div><ol class="places">${places}</ol></div>` : ""}
        ${extra}`;
}

/**
 * Cartes d'un jour (mini-carte des étapes, traces Coros) à l'intérieur de `root`.
 * Renvoie {remove()} : à appeler avant de remplacer le contenu (Leaflet se charge à la demande, on ne crée rien si c'est trop tard).
 */
export function initDayMaps(root, e, acts = []) {
  const maps = [];
  let dead = false;
  (async () => {
    const places = e.places || [];
    let trackEls = [...root.querySelectorAll(".trackmap")];
    let mini = root.querySelector("#minimap");
    if (!places.length && !trackEls.length) return;
    try {
      const L = await loadLeaflet();
      if (dead) return;
      trackEls = trackEls.filter((el) => el.isConnected);
      if (mini && !mini.isConnected) mini = null;
      if (!mini && !trackEls.length) return;
      const mk = (el) => {
        const m = L.map(el, { scrollWheelZoom: false });
        addTiles(L, m);
        maps.push(m);
        return m;
      };
      if (mini && places.length) {
        const m = mk(mini);
        const pts = places.map((p) => [p.lat, p.lng]);
        const line = dayLine(e);
        if (line) L.polyline(line.pts, { color: "#2f6f55", weight: 4, opacity: 0.8, ...(line.routed ? {} : { dashArray: "6 6" }) }).addTo(m);
        places.forEach((p, n) =>
          L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", html: `<span class="pin map">${n + 1}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
            .addTo(m)
            .bindPopup(esc(p.name))
        );
        if (pts.length === 1) m.setView(pts[0], 12);
        else m.fitBounds(line?.routed ? [...pts, ...line.pts] : pts, { padding: [24, 24], maxZoom: 13 });
      }
      for (const el of trackEls) {
        const a = acts[Number(el.dataset.i)];
        if (!a?.track?.length) continue;
        const m = mk(el);
        const line = L.polyline(a.track, { color: "#c5603a", weight: 4 }).addTo(m);
        L.circleMarker(a.track[0], { radius: 6, color: "#2f6f55", fillColor: "#2f6f55", fillOpacity: 1 }).addTo(m);
        L.circleMarker(a.track.at(-1), { radius: 6, color: "#c5603a", fillColor: "#fff", fillOpacity: 1 }).addTo(m);
        m.fitBounds(line.getBounds(), { padding: [20, 20] });
      }
    } catch {
      root.querySelector("#minimap")?.remove();
      root.querySelectorAll(".trackmap").forEach((el) => el.remove());
    }
  })();
  return {
    remove() {
      dead = true;
      maps.forEach((m) => m.remove());
      maps.length = 0;
    },
  };
}
