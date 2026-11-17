import {
  api, getToken, setToken, mediaUrl, esc, md, ymd, parseYmd, fmtLong, fmtMonth,
  videoEmbed, osmLink, loadLeaflet, addTiles,
} from "./common.js";

const ADMIN = document.body.dataset.admin === "1";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const $ = (s) => document.querySelector(s);

let entries = [];
let byDate = {};
const today = new Date();
let cur = { y: today.getFullYear(), m: today.getMonth() };
let bigMap = null;
let miniMap = null;

/* ---------- Données ---------- */

async function load() {
  const r = await api("/entries");
  entries = r.entries || [];
  byDate = Object.fromEntries(entries.map((e) => [e.date, e]));
}

function pickInitialMonth() {
  const here = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  if (!entries.length || entries.some((e) => e.date.startsWith(here))) return;
  const last = parseYmd(entries[entries.length - 1].date);
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
    const cls = ["cell"];
    if (ds === todayStr) cls.push("today");
    if (e) cls.push("has");
    const thumb = e?.photos?.[0]?.thumb || e?.photos?.[0]?.key;
    if (thumb) cls.push("photo");
    const style = thumb ? ` style="--bg:url('${mediaUrl(thumb)}')"` : "";
    const badges = e
      ? `<span class="badges">${e.audios?.length ? "🎙" : ""}${e.videos?.length ? "▶" : ""}${e.places?.length ? "📍" : ""}</span>`
      : "";
    const inner = `<span class="n">${d}</span>${e ? `<span class="t">${esc(e.title || "")}</span>${badges}` : ""}`;
    if (e || ADMIN) {
      html += `<button class="${cls.join(" ")}" data-date="${ds}"${style} aria-label="${esc(fmtLong(ds))}${e ? " : " + esc(e.title || "") : ""}">${inner}</button>`;
    } else {
      html += `<div class="${cls.join(" ")}">${inner}</div>`;
    }
  }
  $("#grid").innerHTML = html;
  const empty = $("#empty");
  if (empty) empty.hidden = entries.length > 0;
}

$("#grid").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-date]");
  if (!b) return;
  const date = b.dataset.date;
  if (byDate[date]) go(date);
  else if (ADMIN) edit(date);
});

$("#prev").onclick = () => { cur = cur.m === 0 ? { y: cur.y - 1, m: 11 } : { y: cur.y, m: cur.m - 1 }; renderCalendar(); };
$("#next").onclick = () => { cur = cur.m === 11 ? { y: cur.y + 1, m: 0 } : { y: cur.y, m: cur.m + 1 }; renderCalendar(); };

/* ---------- Onglets ---------- */

document.querySelectorAll(".tabs button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    const map = b.dataset.tab === "map";
    $("#cal").hidden = map;
    $("#mapview").hidden = !map;
    if (map) showBigMap();
  };
});

async function showBigMap() {
  const note = $("#mapnote");
  const points = entries.flatMap((e) => (e.places || []).map((p) => ({ ...p, date: e.date })));
  note.textContent = points.length ? "" : "Aucun lieu renseigné pour l'instant.";
  try {
    const L = await loadLeaflet();
    if (!bigMap) {
      bigMap = L.map("bigmap", { scrollWheelZoom: false }).setView([-41.2, 173.3], 5);
      addTiles(L, bigMap);
    }
    bigMap.eachLayer((l) => { if (!(l instanceof L.TileLayer)) bigMap.removeLayer(l); });
    setTimeout(() => bigMap.invalidateSize(), 50);
    if (!points.length) return;
    const latlngs = points.map((p) => [p.lat, p.lng]);
    L.polyline(latlngs, { color: "#2f6f55", weight: 3, opacity: 0.6, dashArray: "6 6" }).addTo(bigMap);
    for (const p of points) {
      L.marker([p.lat, p.lng])
        .addTo(bigMap)
        .bindPopup(`<strong>${esc(p.name)}</strong><br><a href="#${p.date}">${esc(fmtLong(p.date))}</a>`);
    }
    bigMap.fitBounds(latlngs, { padding: [30, 30], maxZoom: 12 });
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
  if (DATE_RE.test(d) && byDate[d]) showDay(d);
  else hideDay();
}

function hideDay() {
  const sheet = $("#day");
  sheet.hidden = true;
  sheet.innerHTML = "";
  if (miniMap) { miniMap.remove(); miniMap = null; }
  updateLock();
}

function showDay(date) {
  const e = byDate[date];
  const dt = parseYmd(date);
  cur = { y: dt.getFullYear(), m: dt.getMonth() };
  renderCalendar();

  const idx = entries.findIndex((x) => x.date === date);
  const prev = entries[idx - 1];
  const next = entries[idx + 1];
  const sheet = $("#day");

  const photos = (e.photos || [])
    .map((p, i) => `<figure data-i="${i}"><img loading="lazy" alt="${esc(p.caption || "Photo du jour")}" src="${mediaUrl(p.thumb || p.key)}">${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`)
    .join("");
  const audios = (e.audios || [])
    .map((a) => `<div class="audio"><span>🎙 ${esc(a.label || "Note vocale")}</span><audio controls preload="none" src="${mediaUrl(a.key)}"></audio></div>`)
    .join("");
  const videos = (e.videos || [])
    .map((v) => `<div class="video">${v.title ? `<p class="vt">${esc(v.title)}</p>` : ""}${videoEmbed(v.url)}</div>`)
    .join("");
  const places = (e.places || [])
    .map((p) => `<li><a href="${osmLink(p.lat, p.lng)}" target="_blank" rel="noopener">${esc(p.name)}</a> <span class="muted">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</span></li>`)
    .join("");

  sheet.innerHTML = `
    <div class="sheet-inner">
      <div class="sheet-bar">
        <button id="sclose">✕ Fermer</button>
        <div class="sheet-nav">
          ${ADMIN ? `<button id="sedit" class="primary">Modifier</button>` : ""}
          <button id="sprev" ${prev ? "" : "disabled"} aria-label="Jour précédent">‹</button>
          <button id="snext" ${next ? "" : "disabled"} aria-label="Jour suivant">›</button>
        </div>
      </div>
      <article>
        <p class="kicker">${esc(fmtLong(date))}</p>
        <h2>${esc(e.title || "Sans titre")}</h2>
        ${e.text ? `<div class="prose">${md(e.text)}</div>` : ""}
        ${photos ? `<div class="gallery">${photos}</div>` : ""}
        ${audios ? `<div class="block">${audios}</div>` : ""}
        ${videos ? `<div class="block">${videos}</div>` : ""}
        ${places ? `<div class="block"><div id="minimap"></div><ul class="places">${places}</ul></div>` : ""}
      </article>
    </div>`;
  sheet.hidden = false;
  sheet.scrollTop = 0;
  updateLock();

  $("#sclose").onclick = closeDay;
  if (prev) $("#sprev").onclick = () => go(prev.date);
  if (next) $("#snext").onclick = () => go(next.date);
  if (ADMIN) $("#sedit").onclick = () => edit(date);
  sheet.querySelector(".gallery")?.addEventListener("click", (ev) => {
    const f = ev.target.closest("figure");
    if (f) openLightbox(e.photos, Number(f.dataset.i));
  });
  if (e.places?.length) initMiniMap(e.places);
}

async function initMiniMap(places) {
  try {
    const L = await loadLeaflet();
    const el = document.getElementById("minimap");
    if (!el) return;
    if (miniMap) miniMap.remove();
    miniMap = L.map(el, { scrollWheelZoom: false });
    addTiles(L, miniMap);
    const pts = places.map((p) => [p.lat, p.lng]);
    places.forEach((p) => L.marker([p.lat, p.lng]).addTo(miniMap).bindPopup(esc(p.name)));
    if (pts.length === 1) miniMap.setView(pts[0], 12);
    else miniMap.fitBounds(pts, { padding: [24, 24], maxZoom: 13 });
  } catch {
    document.getElementById("minimap")?.remove();
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
      if (savedDate && byDate[savedDate]) {
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

/* ---------- Démarrage ---------- */

async function boot() {
  if (ADMIN) {
    await ensureLogin();
    $("#today").onclick = () => edit(ymd(new Date()));
    $("#logout").onclick = () => { setToken(null); location.reload(); };
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
