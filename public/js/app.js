import {
  api, getToken, setToken, mediaUrl, esc, md, ymd, parseYmd, fmtLong, fmtMonth,
  videoEmbed, loadLeaflet, addTiles, fmtDur, fmtPace, fmtKm, actLabel, actTitle,
} from "./common.js";

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
let maps = [];

/* ---------- Données ---------- */

async function load() {
  const [r, a] = await Promise.all([api("/entries"), api("/activities").catch(() => ({ activities: [] }))]);
  entries = r.entries || [];
  byDate = Object.fromEntries(entries.map((e) => [e.date, e]));
  activities = a.activities || [];
  actsByDate = {};
  for (const x of activities) (actsByDate[x.date] ||= []).push(x);
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
    const thumb = e?.photos?.[0]?.thumb || e?.photos?.[0]?.key;
    if (thumb) cls.push("photo");
    const style = thumb ? ` style="--bg:url('${mediaUrl(thumb)}')"` : "";
    const label = e?.title || (acts.length ? "🏃 " + acts.map((a) => fmtKm(a.distanceKm || 0) + " km").join(" + ") : "");
    const badges = day
      ? `<span class="badges">${acts.length ? "🏃" : ""}${e?.audios?.length ? "🎙" : ""}${e?.videos?.length ? "▶" : ""}${e?.places?.length ? "📍" : ""}</span>`
      : "";
    const inner = `<span class="n">${d}</span>${day ? `<span class="t">${esc(label)}</span>${badges}` : ""}`;
    if (day || ADMIN) {
      html += `<button class="${cls.join(" ")}" data-date="${ds}"${style} aria-label="${esc(fmtLong(ds))}${label ? " : " + esc(label) : ""}">${inner}</button>`;
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
  const map = name === "map";
  $("#cal").hidden = map;
  $("#mapview").hidden = !map;
  if (map) showBigMap();
}
document.querySelectorAll(".tabs button").forEach((b) => {
  b.onclick = () => setTab(b.dataset.tab);
});

/** Depuis une étape d'un jour : ferme la fiche et affiche la grande carte centrée sur ce point. */
let mapFocus = null;
function focusOnMap(date, place) {
  mapFocus = { date, lat: place.lat, lng: place.lng };
  if (location.hash) closeDay();
  setTab("map");
}

/** Ligne à tracer pour un jour : itinéraire routier si calculé, sinon lignes droites entre les étapes (sauf si désactivé). */
function dayLine(e) {
  const pl = e.places || [];
  if (pl.length < 2 || e.routeMode === "none") return null;
  if (e.route?.points?.length > 1) return { pts: e.route.points, routed: true };
  return { pts: pl.map((p) => [p.lat, p.lng]), routed: false };
}

async function showBigMap() {
  const note = $("#mapnote");
  const points = entries.flatMap((e) => (e.places || []).map((p) => ({ ...p, date: e.date })));
  const tracks = activities.filter((a) => a.track?.length > 1);
  note.textContent = points.length || tracks.length ? "" : "Aucun lieu renseigné pour l'instant.";
  try {
    const L = await loadLeaflet();
    if (!bigMap) {
      bigMap = L.map("bigmap", { scrollWheelZoom: false }).setView([-41.2, 173.3], 5);
      addTiles(L, bigMap);
    }
    bigMap.eachLayer((l) => { if (!(l instanceof L.TileLayer)) bigMap.removeLayer(l); });
    setTimeout(() => bigMap.invalidateSize(), 50);
    if (!points.length && !tracks.length) return;
    const latlngs = points.map((p) => [p.lat, p.lng]);
    for (const e of entries) {
      const line = dayLine(e);
      if (line) L.polyline(line.pts, { color: "#2f6f55", weight: 3, opacity: 0.7, ...(line.routed ? {} : { dashArray: "6 6" }) }).addTo(bigMap);
      if (line?.routed) latlngs.push(...line.pts);
    }
    for (const a of tracks) {
      L.polyline(a.track, { color: "#c5603a", weight: 4, opacity: 0.9 })
        .addTo(bigMap)
        .bindPopup(`<strong>${esc(actTitle(a))}</strong><br><a href="#${a.date}">${esc(fmtLong(a.date))}</a>`);
      latlngs.push(...a.track);
    }
    const markers = points.map((p) => ({
      p,
      m: L.marker([p.lat, p.lng])
        .addTo(bigMap)
        .bindPopup(`<strong>${esc(p.name)}</strong><br><a href="#${p.date}">${esc(fmtLong(p.date))}</a>`),
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

/* ---------- Fiche d'un jour ---------- */

function go(date) {
  if (location.hash === "#" + date) route();
  else location.hash = date;
}

function closeDay() {
  history.pushState(null, "", location.pathname + location.search);
  route();
}

function route() {
  const d = location.hash.slice(1);
  if (DATE_RE.test(d) && hasDay(d)) showDay(d);
  else hideDay();
}

function hideDay() {
  const sheet = $("#day");
  sheet.hidden = true;
  sheet.innerHTML = "";
  clearMaps();
  updateLock();
}

function clearMaps() {
  maps.forEach((m) => m.remove());
  maps = [];
}

function showDay(date) {
  const e = dayOf(date);
  const acts = actsByDate[date] || [];
  const dt = parseYmd(date);
  cur = { y: dt.getFullYear(), m: dt.getMonth() };
  renderCalendar();

  const dates = allDates();
  const idx = dates.indexOf(date);
  const prev = dates[idx - 1] ? { date: dates[idx - 1] } : null;
  const next = dates[idx + 1] ? { date: dates[idx + 1] } : null;
  const sheet = $("#day");
  clearMaps();

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
      <article>
        <p class="kicker">${esc(fmtLong(date))}</p>
        <h2>${esc(e.title || (acts.length ? acts.map(actTitle).join(" + ") : "Sans titre"))}</h2>
        ${e.text ? `<div class="prose">${md(e.text)}</div>` : ""}
        ${runs}
        ${photos ? `<div class="gallery">${photos}</div>` : ""}
        ${audios ? `<div class="block">${audios}</div>` : ""}
        ${videos ? `<div class="block">${videos}</div>` : ""}
        ${places ? `<div class="block"><div id="minimap"></div><ol class="places">${places}</ol></div>` : ""}
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
  initMaps(e, acts);
}

async function initMaps(e, acts) {
  const places = e.places || [];
  let trackEls = [...document.querySelectorAll(".trackmap")];
  let mini = document.getElementById("minimap");
  if (!places.length && !trackEls.length) return;
  try {
    const L = await loadLeaflet();
    // l'utilisateur a pu changer de jour pendant le chargement de Leaflet
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
    document.getElementById("minimap")?.remove();
    document.querySelectorAll(".trackmap").forEach((el) => el.remove());
  }
}

/* ---------- Visionneuse photo ---------- */

function openLightbox(photos, start) {
  const box = $("#lightbox");
  let i = start;
  const draw = () => {
    const p = photos[i];
    box.innerHTML = `
      <button class="lb-x" aria-label="Fermer">✕</button>
      ${photos.length > 1 ? `<button class="lb-p" aria-label="Précédente">‹</button><button class="lb-n" aria-label="Suivante">›</button>` : ""}
      <img alt="${esc(p.caption || "")}" src="${mediaUrl(p.key)}">
      ${p.caption ? `<p>${esc(p.caption)}</p>` : ""}`;
    box.querySelector(".lb-x").onclick = close;
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
  route();
}

window.addEventListener("hashchange", route);
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !$("#day").hidden && $("#lightbox").hidden && !document.querySelector(".editor")) closeDay();
});
boot();
