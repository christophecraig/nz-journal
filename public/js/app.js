import {
  api, getToken, setToken, mediaUrl, esc, ymd, parseYmd, fmtLong, fmtMonth,
  loadLeaflet, addTiles, fmtKm, actTitle, dayFromUrl, dayPath,
} from "./common.js";
import { dayLine, renderDayArticle, initDayMaps } from "./dayview.js";
import { mountComments, commentsEnabled, finishAuthRedirect } from "./comments.js";
import { initAnalytics, track } from "./analytics.js";
import { CONFIG } from "./config.js";
import { computeTripStats, statChips } from "./stats.js";
import { createSeen } from "./seen.js";
import { buildWall } from "./wall.js";
import { buildFrames } from "./replay.js";

const ADMIN = document.body.dataset.admin === "1";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const $ = (s) => document.querySelector(s);

let entries = [];
let byDate = {};
let activities = [];
let actsByDate = {};
const today = new Date();
let cur = { y: today.getFullYear(), m: today.getMonth() };
let bigMap = null;
let bigL = null; // Leaflet, une fois chargé
let staticLayer = null; // tout ce que la grande carte montre en temps normal (retiré pendant la lecture)
let dayMaps = null;
const seen = ADMIN ? null : createSeen(); // pastilles « nouveau » : visiteurs seulement

/* ---------- Données ---------- */

async function load() {
  const [r, a] = await Promise.all([api("/entries", { auth: ADMIN }), api("/activities").catch(() => ({ activities: [] }))]);
  entries = r.entries || [];
  byDate = Object.fromEntries(entries.map((e) => [e.date, e]));
  activities = a.activities || [];
  actsByDate = {};
  for (const x of activities) (actsByDate[x.date] ||= []).push(x);
  stopReplay(); // les données ont changé : la séquence en cours n'a plus de sens
  wallDirty = true;
  if (!$("#photosview")?.hidden) renderWall();
  renderTripStats();
}

const hasDay = (d) => !!(byDate[d] || actsByDate[d]);
const allDates = () => [...new Set([...entries.map((e) => e.date), ...activities.map((a) => a.date)])].sort();
/** Une fiche, réelle ou synthétisée à partir des seules courses du jour. */
const dayOf = (d) => byDate[d] || { date: d, title: "", text: "", photos: [], audios: [], videos: [], places: [], synthetic: true };

function pickInitialMonth() {
  const here = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const dates = allDates();
  if (!dates.length || dates.some((d) => d.startsWith(here))) return;
  const last = parseYmd(dates[dates.length - 1]);
  cur = { y: last.getFullYear(), m: last.getMonth() };
}

const updateLock = () =>
  document.body.classList.toggle("lock", !!document.querySelector(".sheet:not([hidden]), .editor, #lightbox:not([hidden])"));

/* ---------- Bandeau « Le voyage en chiffres » ---------- */

function renderTripStats() {
  const box = $("#trip");
  if (!box) return; // page sans bandeau (admin)
  const chips = statChips(
    computeTripStats({ entries, activities, start: CONFIG.tripStart, end: CONFIG.tripEnd, today: ymd(new Date()) })
  );
  box.innerHTML = chips.map((c) => `<li><span aria-hidden="true">${c.icon}</span> ${esc(c.text)}</li>`).join("");
  box.hidden = !chips.length;
}

/* ---------- Calendrier ---------- */

function renderCalendar() {
  $("#mtitle").textContent = fmtMonth(cur.y, cur.m);
  const first = new Date(cur.y, cur.m, 1);
  const offset = (first.getDay() + 6) % 7; // lundi = 0
  const nDays = new Date(cur.y, cur.m + 1, 0).getDate();
  const todayStr = ymd(today);
  let html = "";
  for (let i = 0; i < offset; i++) html += `<div class="cell void"></div>`;
  for (let d = 1; d <= nDays; d++) {
    const ds = ymd(new Date(cur.y, cur.m, d));
    const e = byDate[ds];
    const acts = actsByDate[ds] || [];
    const day = !!(e || acts.length);
    const cls = ["cell"];
    if (ds === todayStr) cls.push("today");
    if (day) cls.push("has");
    if (ADMIN && e?.draft) cls.push("draft");
    const fresh = !!(seen && e && seen.isNew(e));
    if (fresh) cls.push("new");
    const thumb = e?.photos?.[0]?.thumb || e?.photos?.[0]?.key;
    if (thumb) cls.push("photo");
    const style = thumb ? ` style="--bg:url('${mediaUrl(thumb)}')"` : "";
    const label = e?.title || (acts.length ? "🏃 " + acts.map((a) => fmtKm(a.distanceKm || 0) + " km").join(" + ") : "");
    const badges = day
      ? `<span class="badges">${acts.length ? "🏃" : ""}${e?.audios?.length ? "🎙" : ""}${e?.videos?.length ? "▶" : ""}${e?.places?.length ? "📍" : ""}${ADMIN && e?.draft ? "✎" : ""}</span>`
      : "";
    const inner = `<span class="n">${d}</span>${day ? `<span class="t">${esc(label)}</span>${badges}` : ""}`;
    if (day || ADMIN) {
      html += `<button class="${cls.join(" ")}" data-date="${ds}"${style} aria-label="${esc(fmtLong(ds))}${label ? " : " + esc(label) : ""}${ADMIN && e?.draft ? " (brouillon)" : ""}${fresh ? " (nouveau)" : ""}">${inner}</button>`;
    } else {
      html += `<div class="${cls.join(" ")}">${inner}</div>`;
    }
  }
  $("#grid").innerHTML = html;
  const empty = $("#empty");
  if (empty) empty.hidden = allDates().length > 0;
}

$("#grid").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-date]");
  if (!b) return;
  const date = b.dataset.date;
  if (hasDay(date)) go(date);
  else if (ADMIN) edit(date);
});

$("#prev").onclick = () => { cur = cur.m === 0 ? { y: cur.y - 1, m: 11 } : { y: cur.y, m: cur.m - 1 }; renderCalendar(); };
$("#next").onclick = () => { cur = cur.m === 11 ? { y: cur.y + 1, m: 0 } : { y: cur.y, m: cur.m + 1 }; renderCalendar(); };

/* ---------- Onglets ---------- */

function setTab(name) {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === name));
  $("#cal").hidden = name !== "cal";
  $("#mapview").hidden = name !== "map";
  $("#photosview").hidden = name !== "photos";
  if (name !== "map") stopReplay();
  if (name === "map") showBigMap();
  if (name === "photos") renderWall();
}

/* ---------- Mur de photos ---------- */

let wallDirty = true; // les données ont changé depuis le dernier rendu
let wallList = []; // toutes les photos à plat, dans l'ordre affiché : la visionneuse y navigue
function renderWall() {
  if (!wallDirty) return;
  wallDirty = false;
  const { groups, list } = buildWall(entries);
  wallList = list;
  $("#wallnote").textContent = groups.length ? "" : "Aucune photo pour l'instant.";
  $("#wall").innerHTML = groups
    .map(
      (g) => `<section class="wallday">
        <h3><a href="${dayUrl(g.date)}" data-day="${g.date}">${esc(fmtLong(g.date))}</a>${g.title ? ` <span class="muted">· ${esc(g.title)}</span>` : ""}</h3>
        <div class="wallgrid">${g.photos
          .map(({ photo: p, index }) => `<button type="button" class="ph" data-i="${index}"><img loading="lazy" decoding="async" alt="${esc(p.caption || "Photo du " + fmtLong(g.date))}" src="${mediaUrl(p.thumb || p.key)}"></button>`)
          .join("")}</div>
      </section>`
    )
    .join("");
}
$("#wall").addEventListener("click", (ev) => {
  const b = ev.target.closest(".ph");
  if (b) openLightbox(wallList, Number(b.dataset.i), { dayLink: true });
});
document.querySelectorAll(".tabs button").forEach((b) => {
  b.onclick = () => setTab(b.dataset.tab);
});

/** Depuis une étape d'un jour : ferme la fiche et affiche la grande carte centrée sur ce point. */
let mapFocus = null;
function focusOnMap(date, place) {
  mapFocus = { date, lat: place.lat, lng: place.lng };
  if (currentDay()) closeDay();
  setTab("map");
}

async function showBigMap() {
  const note = $("#mapnote");
  const points = entries.flatMap((e) => (e.places || []).map((p) => ({ ...p, date: e.date })));
  const tracks = activities.filter((a) => a.track?.length > 1);
  note.textContent = points.length || tracks.length ? "" : "Aucun lieu renseigné pour l'instant.";
  try {
    const L = await loadLeaflet();
    bigL = L;
    stopReplay();
    if (!bigMap) {
      bigMap = L.map("bigmap", { scrollWheelZoom: false }).setView([-41.2, 173.3], 5);
      addTiles(L, bigMap);
    }
    bigMap.eachLayer((l) => { if (!(l instanceof L.TileLayer)) bigMap.removeLayer(l); });
    staticLayer = L.layerGroup().addTo(bigMap);
    setTimeout(() => bigMap.invalidateSize(), 50);
    initReplayBar();
    if (!points.length && !tracks.length) return;
    const latlngs = points.map((p) => [p.lat, p.lng]);
    for (const e of entries) {
      const line = dayLine(e);
      if (line) L.polyline(line.pts, { color: "#2f6f55", weight: 3, opacity: 0.7, ...(line.routed ? {} : { dashArray: "6 6" }) }).addTo(staticLayer);
      if (line?.routed) latlngs.push(...line.pts);
    }
    for (const a of tracks) {
      L.polyline(a.track, { color: "#c5603a", weight: 4, opacity: 0.9 })
        .addTo(staticLayer)
        .bindPopup(`<strong>${esc(actTitle(a))}</strong><br><a href="${dayUrl(a.date)}" data-day="${a.date}">${esc(fmtLong(a.date))}</a>`);
      latlngs.push(...a.track);
    }
    const markers = points.map((p) => ({
      p,
      m: L.marker([p.lat, p.lng])
        .addTo(staticLayer)
        .bindPopup(`<strong>${esc(p.name)}</strong><br><a href="${dayUrl(p.date)}" data-day="${p.date}">${esc(fmtLong(p.date))}</a>`),
    }));
    const focus = mapFocus;
    mapFocus = null;
    const target = focus && markers.find(({ p }) => p.date === focus.date && p.lat === focus.lat && p.lng === focus.lng);
    if (target) {
      bigMap.invalidateSize();
      bigMap.setView([focus.lat, focus.lng], 14);
      target.m.openPopup();
    } else {
      bigMap.fitBounds(latlngs, { padding: [30, 30], maxZoom: 14 });
    }
  } catch (e) {
    note.textContent = e.message;
  }
}

/* ---------- Rejouer le voyage ---------- */

const REPLAY_STEP_MS = 1600;
let replay = null; // { frames, i, layer, timer, playing } pendant une lecture (en pause comprise)
const reducedMotion = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function replayUi() {
  const playing = !!replay?.playing;
  $("#replay").textContent = playing ? "⏸ Pause" : replay ? "▶ Reprendre" : "▶ Rejouer le voyage";
  $("#replaystop").hidden = !replay;
}

function initReplayBar() {
  const n = buildFrames(entries, activities).length;
  $("#replay").hidden = n === 0;
  $("#replaylabel").textContent = "";
  replayUi();
}

/** Revient à la carte complète (appelé en fin de lecture, au bouton ■, au changement d'onglet ou de données). */
function stopReplay() {
  if (!replay) return;
  clearTimeout(replay.timer);
  replay.layer.remove(); // retire toutes les couches de la lecture : pas de fuite
  replay = null;
  if (bigMap && staticLayer) staticLayer.addTo(bigMap);
  $("#replaylabel").textContent = "";
  replayUi();
}

function drawFrame(f) {
  const L = bigL;
  for (const l of f.lines) {
    L.polyline(l.pts, { color: l.kind === "run" ? "#c5603a" : "#2f6f55", weight: l.kind === "run" ? 4 : 3, opacity: 0.85, ...(l.routed ? {} : { dashArray: "6 6" }) }).addTo(replay.layer);
  }
  for (const m of f.markers) {
    L.circleMarker([m.lat, m.lng], { radius: 6, color: "#fff", weight: 2, fillColor: "#2f6f55", fillOpacity: 1 })
      .addTo(replay.layer)
      .bindPopup(`<strong>${esc(m.name)}</strong><br><a href="${dayUrl(f.date)}" data-day="${f.date}">${esc(fmtLong(f.date))}</a>`);
  }
  bigMap.fitBounds(f.points, { padding: [40, 40], maxZoom: 11, animate: true, duration: 0.9 });
  $("#replaylabel").innerHTML = `<a href="${dayUrl(f.date)}" data-day="${f.date}">${esc(fmtLong(f.date))}</a>${f.title ? ` · ${esc(f.title)}` : ""}`;
}

function replayStep() {
  if (!replay?.playing) return;
  const f = replay.frames[replay.i++];
  if (!f) return stopReplay();
  drawFrame(f);
  if (replay.i >= replay.frames.length) {
    // dernier jour affiché un instant, puis retour à la carte complète
    replay.timer = setTimeout(stopReplay, REPLAY_STEP_MS * 1.5);
    replay.playing = false;
    replayUi();
    return;
  }
  replay.timer = setTimeout(replayStep, REPLAY_STEP_MS);
}

function toggleReplay() {
  if (!bigMap || !bigL) return;
  const frames = buildFrames(entries, activities);
  if (!frames.length) return;
  if (reducedMotion()) {
    // pas d'animation : tout le voyage d'un coup
    stopReplay();
    bigMap.fitBounds(frames.flatMap((f) => f.points), { padding: [30, 30], maxZoom: 14, animate: false });
    $("#replaylabel").textContent = `Voyage complet · ${frames.length} jour${frames.length > 1 ? "s" : ""} sur la carte`;
    return;
  }
  if (replay && replay.i >= replay.frames.length) stopReplay(); // lecture terminée, retour en cours : on repart du début
  if (replay?.playing) {
    clearTimeout(replay.timer);
    replay.playing = false;
    replayUi();
    return;
  }
  if (!replay) {
    bigMap.removeLayer(staticLayer);
    replay = { frames, i: 0, layer: bigL.layerGroup().addTo(bigMap), timer: null, playing: false };
  }
  replay.playing = true;
  replayUi();
  replayStep();
}
$("#replay").onclick = toggleReplay;
$("#replaystop").onclick = stopReplay;

/* ---------- Fiche d'un jour ---------- */

/* Public : /jour/AAAA-MM-JJ (vraie adresse partageable). Admin : on garde #AAAA-MM-JJ, car /admin est une page à part. */
const dayUrl = (date) => (ADMIN ? `${location.pathname}#${date}` : dayPath(date));
const homeUrl = () => (ADMIN ? location.pathname : "/");
const currentDay = () => (ADMIN ? (DATE_RE.test(location.hash.slice(1)) ? location.hash.slice(1) : "") : dayFromUrl(location.pathname, location.hash));

function go(date) {
  if (currentDay() !== date) history.pushState(null, "", dayUrl(date));
  route();
}

function closeDay() {
  history.pushState(null, "", homeUrl());
  route();
}

let firstRoute = true;
function route() {
  const d = currentDay();
  // Ancien lien public avec #date : on le convertit en /jour/date sans recharger.
  if (!ADMIN && d && location.pathname !== dayPath(d)) history.replaceState(null, "", dayPath(d));
  if (d && hasDay(d)) showDay(d);
  else {
    if (d) history.replaceState(null, "", homeUrl()); // jour inconnu
    hideDay();
    if (firstRoute) track("/", "Accueil"); // GoatCounter ne compte plus le chargement tout seul (no_onload)
  }
  firstRoute = false;
}

function hideDay() {
  const sheet = $("#day");
  sheet.hidden = true;
  sheet.innerHTML = "";
  clearMaps();
  updateLock();
}

function clearMaps() {
  dayMaps?.remove();
  dayMaps = null;
}

function showDay(date) {
  const e = dayOf(date);
  const acts = actsByDate[date] || [];
  const dt = parseYmd(date);
  cur = { y: dt.getFullYear(), m: dt.getMonth() };
  if (seen && !e.synthetic) seen.markSeen(e); // ouvrir un jour efface sa pastille
  renderCalendar();

  const dates = allDates();
  const idx = dates.indexOf(date);
  const prev = dates[idx - 1] ? { date: dates[idx - 1] } : null;
  const next = dates[idx + 1] ? { date: dates[idx + 1] } : null;
  const sheet = $("#day");
  clearMaps();

  sheet.innerHTML = `
    <div class="sheet-inner">
      <div class="sheet-bar">
        <button id="sclose">✕ Fermer</button>
        <div class="sheet-nav">
          ${ADMIN ? `<button id="sedit" class="primary">${e.synthetic ? "Écrire ce jour" : "Modifier"}</button>` : ""}
          <button id="sprev" ${prev ? "" : "disabled"} aria-label="Jour précédent">‹</button>
          <button id="snext" ${next ? "" : "disabled"} aria-label="Jour suivant">›</button>
        </div>
      </div>
      ${ADMIN && e.draft ? `<p class="draftnote">✎ Brouillon : ce jour n'est pas visible par les visiteurs.</p>` : ""}
      <article>${renderDayArticle(e, acts, { extra: commentsEnabled() ? `<section id="comments" class="comments"></section>` : "" })}
      </article>
    </div>`;
  sheet.hidden = false;
  sheet.scrollTop = 0;
  updateLock();

  $("#sclose").onclick = closeDay;
  if (prev) $("#sprev").onclick = () => go(prev.date);
  if (next) $("#snext").onclick = () => go(next.date);
  if (ADMIN) $("#sedit").onclick = () => edit(date);
  sheet.querySelector("article").addEventListener("click", (ev) => {
    const f = ev.target.closest(".gallery figure");
    if (f) return openLightbox(e.photos, Number(f.dataset.i));
    const b = ev.target.closest(".stoplink");
    if (b && e.places[Number(b.dataset.n)]) focusOnMap(date, e.places[Number(b.dataset.n)]);
  });
  dayMaps = initDayMaps(sheet, e, acts);
  mountComments($("#comments"), date, { admin: ADMIN });
  track(`/jour/${date}`, e.title || fmtLong(date));
}

/* ---------- Visionneuse photo ---------- */

function openLightbox(photos, start, { dayLink = false } = {}) {
  const box = $("#lightbox");
  let i = start;
  const draw = () => {
    const p = photos[i];
    box.innerHTML = `
      <button class="lb-x" aria-label="Fermer">✕</button>
      ${photos.length > 1 ? `<button class="lb-p" aria-label="Précédente">‹</button><button class="lb-n" aria-label="Suivante">›</button>` : ""}
      <img alt="${esc(p.caption || "")}" src="${mediaUrl(p.key)}">
      ${p.caption ? `<p>${esc(p.caption)}</p>` : ""}
      ${dayLink && p.date ? `<button type="button" class="lb-day">Voir le jour</button>` : ""}`;
    box.querySelector(".lb-x").onclick = close;
    box.querySelector(".lb-day")?.addEventListener("click", () => { close(); go(p.date); });
    box.querySelector(".lb-p")?.addEventListener("click", () => { i = (i - 1 + photos.length) % photos.length; draw(); });
    box.querySelector(".lb-n")?.addEventListener("click", () => { i = (i + 1) % photos.length; draw(); });
  };
  const close = () => {
    box.hidden = true;
    box.innerHTML = "";
    document.removeEventListener("keydown", onKey);
    updateLock();
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") close();
    if (ev.key === "ArrowLeft") box.querySelector(".lb-p")?.click();
    if (ev.key === "ArrowRight") box.querySelector(".lb-n")?.click();
  };
  box.onclick = (ev) => { if (ev.target === box) close(); };
  document.addEventListener("keydown", onKey);
  box.hidden = false;
  draw();
  updateLock();
}

/* ---------- Admin ---------- */

function ensureLogin() {
  return new Promise(async (resolve) => {
    if (getToken()) {
      try { await api("/me"); return resolve(); }
      catch (e) {
        if (e.status === 401) setToken(null);
        else return resolve(); // réseau coupé : on laisse l'interface s'ouvrir
      }
    }
    const box = $("#login");
    box.hidden = false;
    $("#pw").focus();
    $("#loginform").onsubmit = async (ev) => {
      ev.preventDefault();
      $("#loginerr").textContent = "";
      try {
        const { token } = await api("/login", { method: "POST", body: { password: $("#pw").value } });
        setToken(token);
        box.hidden = true;
        resolve();
      } catch (e) {
        $("#loginerr").textContent = e.message;
      }
    };
  });
}

async function edit(date) {
  const { openEditor } = await import("./editor.js");
  openEditor({
    date,
    entry: byDate[date],
    onDone: async (savedDate) => {
      await load();
      if (savedDate && hasDay(savedDate)) {
        const dt = parseYmd(savedDate);
        cur = { y: dt.getFullYear(), m: dt.getMonth() };
        renderCalendar();
        go(savedDate);
      } else {
        renderCalendar();
        closeDay();
      }
    },
  });
}

/* ---------- Coros (statut et connexion, admin uniquement) ---------- */

async function corosInit() {
  const line = $("#corosline");
  const refresh = async () => {
    try {
      const s = await api("/coros/status");
      $("#corosconnect").hidden = s.connected;
      $("#corossync").hidden = !s.connected;
      const when = s.lastSync ? new Date(s.lastSync).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "jamais";
      line.textContent = s.connected
        ? `Coros connecté · ${s.activityCount} course(s) · dernière synchro : ${when}${s.lastError ? " · ⚠ " + s.lastError : ""}`
        : `Coros non connecté.${s.lastError ? " ⚠ " + s.lastError : ""}`;
      line.classList.toggle("err", !!s.lastError);
    } catch (e) {
      line.textContent = "Coros : statut indisponible (" + e.message + ")";
    }
  };
  $("#corosconnect").onclick = async () => {
    try {
      const { url } = await api("/coros/connect", { method: "POST" });
      location.href = url;
    } catch (e) {
      line.textContent = "⚠ " + e.message;
    }
  };
  $("#corossync").onclick = async () => {
    const btn = $("#corossync");
    btn.disabled = true;
    line.textContent = "Synchronisation…";
    try {
      for (let i = 0; i < 6; i++) {
        const r = await api("/coros/sync", { method: "POST", body: { days: 45 } });
        if (!r.added) break;
      }
      await load();
      renderCalendar();
    } catch (e) {
      line.textContent = "⚠ " + e.message;
      btn.disabled = false;
      return;
    }
    btn.disabled = false;
    await refresh();
  };
  const result = new URLSearchParams(location.search).get("coros");
  if (result) history.replaceState(null, "", location.pathname);
  await refresh();
  if (result === "ok") $("#corossync").click();
}

/* ---------- Démarrage ---------- */

async function boot() {
  initAnalytics({ admin: ADMIN });
  if (ADMIN) {
    await ensureLogin();
    $("#today").onclick = () => edit(ymd(new Date()));
    $("#logout").onclick = () => { setToken(null); location.reload(); };
    corosInit();
  }
  try {
    await load();
  } catch (e) {
    $("#grid").innerHTML = `<p class="err">Impossible de charger le carnet : ${esc(e.message)}</p>`;
    return;
  }
  pickInitialMonth();
  renderCalendar();
  await finishAuthRedirect(); // retour de Google : on reprend le jour que le visiteur lisait
  route();
}

window.addEventListener("popstate", route);
window.addEventListener("hashchange", route); // admin et anciens liens
// Les liens de jour (popups de la carte) naviguent sans recharger la page.
document.addEventListener("click", (ev) => {
  const a = ev.target.closest?.("a[data-day]");
  if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
  ev.preventDefault();
  go(a.dataset.day);
}, true); // capture : Leaflet bloque la propagation des clics à l'intérieur d'un popup
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !$("#day").hidden && $("#lightbox").hidden && !document.querySelector(".editor")) closeDay();
});
boot();
