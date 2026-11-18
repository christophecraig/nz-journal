import { api, esc, mediaUrl, fmtLong, setToken, loadLeaflet, addTiles } from "./common.js";
import { renderDayArticle, initDayMaps } from "./dayview.js";
import { createDraftStore, shouldOffer, stable } from "./draft.js";
import { withRetry } from "./uploader.js";
import { SECTIONS, insertSection } from "./sections.js";

const MAX_BYTES = 5.5 * 1024 * 1024;
const $ = (root, s) => root.querySelector(s);

const updateLock = () =>
  document.body.classList.toggle("lock", !!document.querySelector(".sheet:not([hidden]), .editor, #lightbox:not([hidden])"));

async function scaleImage(bmp, max, quality) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("Conversion de l'image impossible"))), "image/jpeg", quality)
  );
}

const upload = (blob, type) =>
  api("/media", { method: "POST", body: blob, headers: { "content-type": type } });

function parseCoords(latStr, lngStr) {
  const pair = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(latStr);
  let lat, lng;
  if (pair) {
    lat = parseFloat(pair[1].replace(",", "."));
    lng = parseFloat(pair[2].replace(",", "."));
  } else {
    lat = parseFloat(String(latStr).replace(",", "."));
    lng = parseFloat(String(lngStr).replace(",", "."));
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const newId = () => Math.random().toString(36).slice(2, 10);
const nowHm = () => new Date().toTimeString().slice(0, 5);

export function openEditor({ date, entry, acts = [], onDone }) {
  const e = entry
    ? structuredClone(entry)
    : { date, title: "", text: "", photos: [], audios: [], places: [], routeMode: "drive" };

  e.places = e.places || [];
  e.routeMode = e.routeMode === "none" ? "none" : "drive";
  for (const p of e.places) if (!p.id) p.id = newId();
  const root = document.createElement("div");
  root.className = "editor";
  root.innerHTML = `
    <div class="sheet-inner">
      <div class="sheet-bar">
        <button type="button" id="ecancel">✕ Annuler</button>
        <button type="button" id="epreview">👁 Aperçu</button>
        <button type="button" id="esave" class="primary">Enregistrer</button>
      </div>
      <p class="kicker">${esc(fmtLong(date))}</p>
      <div id="edraftbanner" class="draftbanner" role="status" hidden>
        <span id="edraftmsg"></span>
        <button type="button" id="drresume" class="primary">Reprendre le brouillon</button>
        <button type="button" id="drignore">Ignorer</button>
      </div>
      <label>Date du jour
        <input id="edate" type="date" value="${esc(date)}">
        <small>Pour déplacer cette fiche (photos, étapes et médias suivent), change la date puis enregistre.</small>
      </label>
      <label class="check"><input id="edraft" type="checkbox" ${e.draft ? "checked" : ""}> Brouillon (non visible par les visiteurs)</label>
      <p id="estatus" class="status" role="status"></p>

      <label>Titre
        <input id="etitle" maxlength="200" placeholder="Ex. Arrivée à Wellington" value="${esc(e.title)}">
      </label>

      <label>Récit du jour
        <textarea id="etext" rows="10" placeholder="Ce qu'on a fait, vu, mangé, ressenti…">${esc(e.text)}</textarea>
        <small>Markdown : **gras**, *italique*, - liste, # titre, [texte](https://lien)</small>
      </label>
      <div class="chips" role="group" aria-label="Ajouter une section au récit">
        ${SECTIONS.map((s) => `<button type="button" class="chip" data-title="${esc(s.title)}">＋ ${esc(s.title.replace(/^\S+\s/, ""))}</button>`).join("")}
      </div>

      <details class="fold" id="fphotos">
        <summary>Photos <span class="count" id="cphotos"></span></summary>
        <div id="ephotos" class="thumbs"></div>
        <div id="eqphotos" class="queue" hidden></div>
        <label class="btn">＋ Ajouter des photos<input id="efile" type="file" accept="image/*" multiple hidden></label>
      </details>

      <details class="fold" id="faudios">
        <summary>Notes vocales <span class="count" id="caudios"></span></summary>
        <div id="eaudios"></div>
        <div id="eqaudios" class="queue" hidden></div>
        <div class="row">
          <button type="button" id="erec">● Enregistrer</button>
          <label class="btn">Importer un audio<input id="eaudiofile" type="file" accept="audio/*" hidden></label>
        </div>
        <small>5 Mo max par note (environ 10 à 15 min en enregistrement direct).</small>
      </details>

      <details class="fold" id="fplaces">
        <summary>Étapes du jour <span class="count" id="cplaces"></span></summary>
        <div id="eplaces"></div>
        <div class="searchbox">
          <input id="epsearch" type="search" placeholder="Chercher un lieu : café, ville, adresse…" autocomplete="off" enterkeyhint="search">
          <ul id="epres" class="results" hidden></ul>
          <p id="epnote" class="searchnote" hidden></p>
        </div>
        <div class="row">
          <button type="button" id="eloc">📍 Ma position</button>
          <button type="button" id="epmap">🗺 Choisir sur la carte</button>
        </div>
        <p id="epchosen" class="chosen" hidden></p>
        <div class="row wrap">
          <input id="epname" placeholder="Nom de l'étape (ex. Café à Mount Maunganui)" maxlength="120">
          <input id="eptime" type="time" aria-label="Heure">
        </div>
        <label class="check"><input id="epapprox" type="checkbox"> Position approximative (arrondie à ~1 km, pour ne pas montrer une adresse précise)</label>
        <details class="adv">
          <summary>Saisie avancée (coordonnées)</summary>
          <div class="row wrap">
            <input id="eplat" placeholder="Latitude (ou « lat, lng »)" inputmode="text">
            <input id="eplng" placeholder="Longitude" inputmode="text">
          </div>
        </details>
        <div class="row"><button type="button" id="epadd" class="primary">Ajouter l'étape</button></div>
        <label class="check"><input id="eroute" type="checkbox" ${e.routeMode === "drive" ? "checked" : ""}> Tracer l'itinéraire en voiture entre les étapes</label>
        <small>Les étapes sont dans l'ordre du trajet (↑ ↓ pour réordonner). L'itinéraire est calculé à l'enregistrement, c'est une approximation de la route. Si un lieu n'est pas trouvé, pose le point sur la carte.</small>
      </details>

      ${entry ? `<button type="button" id="edel" class="danger">Supprimer ce jour</button>` : ""}
    </div>`;
  document.body.appendChild(root);
  updateLock();
  root.scrollTop = 0;

  const status = (msg, isErr = false) => {
    const s = $(root, "#estatus");
    s.textContent = msg;
    s.classList.toggle("err", isErr);
  };
  const fail = (err) => {
    if (err.status === 401) {
      setToken(null);
      alert("Session expirée, reconnecte-toi.");
      location.reload();
      return;
    }
    status(err.message || String(err), true);
  };
  let closed = false;
  const cleanups = []; // écouteurs et minuteurs à retirer à la fermeture
  const close = () => {
    closed = true;
    [...cleanups].forEach((f) => f()); // copie : l'aperçu ouvert se retire lui-même de la liste
    root.remove();
    updateLock();
  };

  /* ----- Rendu des listes ----- */

  /** Compteurs affichés sur les sections repliées. */
  function updateCounts() {
    for (const [id, n] of [["photos", e.photos.length], ["audios", e.audios.length], ["places", e.places.length]]) {
      $(root, "#c" + id).textContent = n ? `· ${n}` : "";
    }
  }

  const photosEl = $(root, "#ephotos");
  const renderPhotos = () => {
    updateCounts();
    photosEl.innerHTML = e.photos
      .map(
        (p, i) => `
      <div class="th" data-i="${i}">
        <img src="${mediaUrl(p.thumb || p.key)}" alt="">
        <input class="cap" value="${esc(p.caption)}" placeholder="Légende" maxlength="300">
        ${e.places.length ? `<select class="stopsel" aria-label="Étape de la photo"><option value="">Aucune étape</option>${e.places.map((pl, n) => `<option value="${esc(pl.id)}" ${pl.id === p.placeId ? "selected" : ""}>${n + 1}. ${esc(pl.name)}</option>`).join("")}</select>` : ""}
        <div class="tb">
          <button type="button" data-act="left" ${i === 0 ? "disabled" : ""}>←</button>
          <button type="button" data-act="right" ${i === e.photos.length - 1 ? "disabled" : ""}>→</button>
          <button type="button" data-act="del">✕</button>
        </div>
      </div>`
      )
      .join("");
  };
  photosEl.addEventListener("input", (ev) => {
    const th = ev.target.closest(".th");
    if (th && ev.target.classList.contains("cap")) e.photos[Number(th.dataset.i)].caption = ev.target.value;
  });
  photosEl.addEventListener("change", (ev) => {
    const th = ev.target.closest(".th");
    if (th && ev.target.classList.contains("stopsel")) {
      const ph = e.photos[Number(th.dataset.i)];
      if (ev.target.value) ph.placeId = ev.target.value;
      else delete ph.placeId;
    }
  });
  photosEl.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-act]");
    if (!b) return;
    const i = Number(b.closest(".th").dataset.i);
    if (b.dataset.act === "del") e.photos.splice(i, 1);
    if (b.dataset.act === "left") [e.photos[i - 1], e.photos[i]] = [e.photos[i], e.photos[i - 1]];
    if (b.dataset.act === "right") [e.photos[i + 1], e.photos[i]] = [e.photos[i], e.photos[i + 1]];
    renderPhotos();
  });

  const audiosEl = $(root, "#eaudios");
  const renderAudios = () => {
    updateCounts();
    audiosEl.innerHTML = e.audios
      .map(
        (a, i) => `
      <div class="item" data-i="${i}">
        <input class="lab" value="${esc(a.label)}" placeholder="Titre de la note" maxlength="120">
        <audio controls preload="none" src="${mediaUrl(a.key)}"></audio>
        <button type="button" data-act="del">✕</button>
      </div>`
      )
      .join("");
  };
  audiosEl.addEventListener("input", (ev) => {
    const it = ev.target.closest(".item");
    if (it && ev.target.classList.contains("lab")) e.audios[Number(it.dataset.i)].label = ev.target.value;
  });
  audiosEl.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-act=del]");
    if (b) { e.audios.splice(Number(b.closest(".item").dataset.i), 1); renderAudios(); }
  });

  const placesEl = $(root, "#eplaces");
  const renderPlaces = () => {
    updateCounts();
    placesEl.innerHTML = e.places
      .map(
        (p, i) => `
      <div class="item stopitem" data-i="${i}">
        <span class="pin">${i + 1}</span>
        <div class="grow">
          <input class="pn" value="${esc(p.name)}" maxlength="120" aria-label="Nom">
          <div class="row">
            <input class="pt" type="time" value="${esc(p.time || "")}" aria-label="Heure">
            <span class="muted">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}${p.approx ? " (approx.)" : ""}</span>
          </div>
          <input class="pnote" value="${esc(p.note || "")}" maxlength="300" placeholder="Note (facultatif)">
        </div>
        <div class="tb">
          <button type="button" data-act="up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" data-act="down" ${i === e.places.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" data-act="del">✕</button>
        </div>
      </div>`
      )
      .join("");
  };
  placesEl.addEventListener("input", (ev) => {
    const it = ev.target.closest(".item");
    if (!it) return;
    const p = e.places[Number(it.dataset.i)];
    if (ev.target.classList.contains("pn")) p.name = ev.target.value;
    if (ev.target.classList.contains("pt")) p.time = ev.target.value || undefined;
    if (ev.target.classList.contains("pnote")) p.note = ev.target.value;
  });
  placesEl.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-act]");
    if (!b) return;
    const i = Number(b.closest(".item").dataset.i);
    if (b.dataset.act === "del") {
      const [gone] = e.places.splice(i, 1);
      for (const ph of e.photos) if (ph.placeId === gone.id) delete ph.placeId;
    }
    if (b.dataset.act === "up") [e.places[i - 1], e.places[i]] = [e.places[i], e.places[i - 1]];
    if (b.dataset.act === "down") [e.places[i + 1], e.places[i]] = [e.places[i], e.places[i + 1]];
    renderPlaces();
    renderPhotos();
  });

  renderPhotos(); renderAudios(); renderPlaces();

  /* ----- Brouillon local : survit à un rechargement ou à une coupure réseau ----- */

  const drafts = createDraftStore();
  const snapshot = () => ({
    title: $(root, "#etitle").value,
    text: $(root, "#etext").value,
    date: $(root, "#edate").value,
    draft: $(root, "#edraft").checked,
    routeMode: e.routeMode,
    photos: e.photos,
    audios: e.audios,
    places: e.places,
  });
  const initialForm = JSON.parse(JSON.stringify(snapshot()));
  const isDirty = () => stable(snapshot()) !== stable(initialForm);
  let saveTimer = null;
  const flushDraft = () => {
    clearTimeout(saveTimer);
    if (closed) return;
    if (isDirty()) drafts.save(date, JSON.parse(JSON.stringify(snapshot())));
    else drafts.clear(date);
  };
  /** À appeler après toute modification : le brouillon est écrit quelques secondes après la dernière. */
  const touch = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushDraft, 2500);
  };
  for (const ev of ["input", "change", "click"]) root.addEventListener(ev, touch);
  const onHidden = () => { if (document.visibilityState === "hidden") flushDraft(); };
  window.addEventListener("pagehide", flushDraft);
  document.addEventListener("visibilitychange", onHidden);
  cleanups.push(() => {
    clearTimeout(saveTimer);
    window.removeEventListener("pagehide", flushDraft);
    document.removeEventListener("visibilitychange", onHidden);
  });

  const applyForm = (f) => {
    $(root, "#etitle").value = f.title;
    $(root, "#etext").value = f.text;
    if (f.date) $(root, "#edate").value = f.date;
    $(root, "#edraft").checked = f.draft;
    e.routeMode = f.routeMode;
    $(root, "#eroute").checked = f.routeMode === "drive";
    e.photos = f.photos; e.audios = f.audios; e.places = f.places;
    for (const p of e.places) if (!p.id) p.id = newId();
    renderPhotos(); renderAudios(); renderPlaces();
  };
  const offered = drafts.load(date);
  if (offered && shouldOffer(offered, entry, initialForm)) {
    const banner = $(root, "#edraftbanner");
    $(root, "#edraftmsg").textContent = `Brouillon non enregistré trouvé (${new Date(offered.ts).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}).`;
    banner.hidden = false;
    $(root, "#drresume").onclick = () => { applyForm(offered.form); banner.hidden = true; status("Brouillon repris. N'oublie pas d'enregistrer."); };
    $(root, "#drignore").onclick = () => { drafts.clear(date); banner.hidden = true; };
  }

  /* ----- Puces de sections : insèrent un titre dans le récit, au curseur (ou à la fin si le champ n'a pas servi) ----- */

  const textEl = $(root, "#etext");
  let textUsed = false;
  textEl.addEventListener("focus", () => { textUsed = true; });
  root.querySelector(".chips").addEventListener("click", (ev) => {
    const b = ev.target.closest(".chip");
    if (!b) return;
    const r = insertSection(textEl.value, textUsed ? textEl.selectionEnd : undefined, b.dataset.title);
    textEl.value = r.text;
    textEl.focus();
    textEl.setSelectionRange(r.cursor, r.cursor);
    textEl.dispatchEvent(new Event("input", { bubbles: true }));
  });

  /* ----- Photos ----- */

  /* Les envois passent par une file : un à la fois, réessais automatiques, reprise au retour du réseau. */
  const queue = [];
  let qid = 0;
  let pumping = false;
  const stateText = (it) =>
    ({
      wait: "En attente…",
      send: "Envoi…",
      retry: `Nouvelle tentative (${it.attempt}/${it.max})…`,
      offline: "Hors ligne : reprise au retour du réseau…",
      fail: `Échec : ${it.error || "erreur"}`,
    })[it.state];
  const renderQueue = () => {
    for (const [kind, el] of [["photo", $(root, "#eqphotos")], ["audio", $(root, "#eqaudios")]]) {
      const items = queue.filter((it) => it.kind === kind);
      el.hidden = !items.length;
      el.innerHTML = items
        .map(
          (it) => `<div class="qitem ${it.state}" data-id="${it.id}">
          <span class="qname">${esc(it.label)}</span>
          <span class="qstate">${esc(stateText(it))}</span>
          ${it.state === "fail" && !it.fatal ? `<button type="button" data-act="retry">Réessayer</button>` : ""}
          ${it.state === "wait" || it.state === "fail" ? `<button type="button" data-act="drop">Retirer</button>` : ""}
        </div>`
        )
        .join("");
    }
  };
  root.addEventListener("click", (ev) => {
    const b = ev.target.closest(".qitem button[data-act]");
    if (!b) return;
    const it = queue.find((x) => x.id === Number(b.closest(".qitem").dataset.id));
    if (!it) return;
    if (b.dataset.act === "drop") queue.splice(queue.indexOf(it), 1);
    if (b.dataset.act === "retry") { it.state = "wait"; pump(); }
    renderQueue();
  });

  const sendBlob = (it, blob, type) =>
    withRetry(
      () => {
        if (it.state !== "send") { it.state = "send"; renderQueue(); }
        return upload(blob, type);
      },
      {
        onRetry: ({ attempt, max }) => { it.state = "retry"; it.attempt = attempt; it.max = max; renderQueue(); },
        onOffline: () => { it.state = "offline"; renderQueue(); },
      }
    );

  async function process(it) {
    it.state = "send";
    renderQueue();
    try {
      if (it.kind === "photo") {
        if (!it.full) {
          try {
            const bmp = await createImageBitmap(it.file, { imageOrientation: "from-image" });
            it.full = await scaleImage(bmp, 1600, 0.82);
            it.thumb = await scaleImage(bmp, 420, 0.7);
            bmp.close?.();
            it.file = null;
          } catch (err) {
            it.fatal = true; // image illisible : réessayer ne servirait à rien
            throw err;
          }
        }
        // une clé déjà obtenue n'est jamais renvoyée (pas de blob en double si seule la miniature a échoué)
        it.fullKey ||= (await sendBlob(it, it.full, "image/jpeg")).key;
        it.thumbKey ||= (await sendBlob(it, it.thumb, "image/jpeg")).key;
        if (closed) return;
        e.photos.push({ key: it.fullKey, thumb: it.thumbKey, caption: "" });
        renderPhotos();
      } else {
        const { key } = await sendBlob(it, it.blob, it.type);
        if (closed) return;
        e.audios.push({ key, label: it.label });
        renderAudios();
      }
      queue.splice(queue.indexOf(it), 1);
      touch();
    } catch (err) {
      if (err.status === 401) return fail(err);
      it.state = "fail";
      it.error = err.message || String(err);
    }
    renderQueue();
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (let it; !closed && (it = queue.find((x) => x.state === "wait")); ) await process(it);
    } finally {
      pumping = false;
    }
    if (closed) return;
    if (!queue.length) status("Médias ajoutés. N'oublie pas d'enregistrer.");
    else if (queue.every((x) => x.state === "fail")) status("Certains envois ont échoué : réessaie ou retire-les.", true);
  }

  const enqueue = (item) => {
    queue.push({ id: ++qid, state: "wait", ...item });
    $(root, item.kind === "photo" ? "#fphotos" : "#faudios").open = true; // l'avancée des envois doit rester visible
    renderQueue();
    status("Envoi des médias en cours…");
    pump();
  };

  // Au retour du réseau, les envois en échec (réseau) repartent d'eux-mêmes.
  const onOnline = () => {
    for (const it of queue) if (it.state === "fail" && !it.fatal) it.state = "wait";
    renderQueue();
    pump();
  };
  window.addEventListener("online", onOnline);
  cleanups.push(() => {
    window.removeEventListener("online", onOnline);
    queue.length = 0;
  });

  $(root, "#efile").onchange = (ev) => {
    const files = [...ev.target.files];
    ev.target.value = "";
    files.forEach((f, i) => enqueue({ kind: "photo", label: f.name || `Photo ${i + 1}`, file: f }));
  };

  /* ----- Audio ----- */

  function addAudio(blob, type, label) {
    if (blob.size > MAX_BYTES) return fail(new Error("Audio trop lourd (max ~5 Mo)"));
    enqueue({ kind: "audio", label: label || "Note vocale", blob, type });
  }

  $(root, "#eaudiofile").onchange = async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("audio/")) return fail(new Error("Ce fichier n'est pas un audio reconnu"));
    await addAudio(f, f.type, f.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Note vocale");
  };

  let rec = null;
  const recBtn = $(root, "#erec");
  recBtn.onclick = async () => {
    if (rec) { rec.stop(); return; }
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      return fail(new Error("Enregistrement non supporté par ce navigateur : utilise « Importer un audio »"));
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const chunks = [];
      const r = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48000 });
      r.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = (r.mimeType || mime || "audio/webm").split(";")[0];
        rec = null;
        recBtn.textContent = "● Enregistrer";
        recBtn.classList.remove("rec");
        await addAudio(new Blob(chunks, { type }), type, `Note vocale ${e.audios.length + 1}`);
      };
      rec = r;
      r.start();
      recBtn.textContent = "■ Arrêter";
      recBtn.classList.add("rec");
      status("Enregistrement en cours…");
    } catch (err) {
      fail(new Error("Micro indisponible : " + err.message));
    }
  };

  /* ----- Lieux ----- */

  const lat = $(root, "#eplat"), lng = $(root, "#eplng"), name = $(root, "#epname"), time = $(root, "#eptime"), approx = $(root, "#epapprox");
  const chosen = $(root, "#epchosen");
  const showChosen = () => {
    const c = parseCoords(lat.value, lng.value);
    chosen.hidden = !c;
    if (c) chosen.textContent = `📍 Point choisi : ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;
  };
  lat.addEventListener("input", showChosen);
  lng.addEventListener("input", showChosen);

  /** Remplit le brouillon d'étape ; si le nom est vide, tente de le deviner depuis les coordonnées. */
  const setDraft = async ({ lat: la, lng: lo, name: nm }) => {
    lat.value = la.toFixed(5);
    lng.value = lo.toFixed(5);
    if (nm) name.value = nm;
    showChosen();
    if (!name.value.trim()) {
      try {
        const { place } = await api(`/geocode?reverse=1&lat=${la}&lon=${lo}`);
        if (place?.name && !name.value.trim()) name.value = place.name;
      } catch { /* le nom reste à saisir */ }
    }
  };

  const addPlace = () => {
    if (!lat.value.trim() && !lng.value.trim()) return true;
    const c = parseCoords(lat.value, lng.value);
    if (!c) { fail(new Error("Coordonnées invalides (ex. -41.2865, 174.7762)")); return false; }
    const p = { id: newId(), name: name.value.trim() || "Étape", ...c };
    if (time.value) p.time = time.value;
    if (approx.checked) p.approx = true; // l'arrondi est appliqué côté serveur à l'enregistrement
    e.places.push(p);
    name.value = lat.value = lng.value = time.value = "";
    approx.checked = false;
    showChosen();
    renderPlaces();
    renderPhotos();
    return true;
  };
  $(root, "#epadd").onclick = () => {
    if (!lat.value.trim() && !lng.value.trim()) return fail(new Error("Cherche un lieu, choisis-le sur la carte ou utilise ta position."));
    if (addPlace()) status("Étape ajoutée. N'oublie pas d'enregistrer.");
  };
  $(root, "#eroute").onchange = (ev) => { e.routeMode = ev.target.checked ? "drive" : "none"; };

  /* Recherche de lieux (le serveur interroge Photon ; secours OpenStreetMap sur demande) */
  const search = $(root, "#epsearch"), resEl = $(root, "#epres"), noteEl = $(root, "#epnote");
  let results = [], seq = 0, timer = null;
  const biasQuery = () => {
    const last = e.places.at(-1);
    return last ? `&lat=${last.lat}&lon=${last.lng}` : "";
  };
  const showNote = (msg, withAlt) => {
    noteEl.hidden = !msg;
    noteEl.innerHTML = msg ? `${esc(msg)}${withAlt ? ` <button type="button" id="epalt">Essayer l'autre source (OpenStreetMap)</button>` : ""}` : "";
  };
  const runSearch = async (mode = "photon") => {
    const q = search.value.trim();
    const my = ++seq;
    if (q.length < 3) { results = []; resEl.hidden = true; showNote(""); return; }
    showNote("Recherche…");
    try {
      const r = await api(`/geocode?q=${encodeURIComponent(q)}${biasQuery()}${mode === "nominatim" ? "&mode=nominatim" : ""}`);
      if (my !== seq) return; // une recherche plus récente a été lancée
      results = r.results;
      resEl.innerHTML = results
        .map((x, i) => `<li><button type="button" data-i="${i}"><strong>${esc(x.name)}</strong><span>${esc(x.detail)}</span></button></li>`)
        .join("");
      resEl.hidden = !results.length;
      showNote(results.length ? "" : "Aucun résultat.", mode === "photon" && !results.length);
    } catch (err) {
      if (my !== seq) return;
      if (err.status === 401) return fail(err);
      results = [];
      resEl.hidden = true;
      showNote(err.message || "Recherche indisponible.", mode === "photon");
    }
  };
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => runSearch(), 400); });
  search.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); clearTimeout(timer); runSearch(); } });
  noteEl.addEventListener("click", (ev) => { if (ev.target.id === "epalt") runSearch("nominatim"); });
  resEl.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (!b) return;
    const x = results[Number(b.dataset.i)];
    search.value = "";
    results = [];
    resEl.hidden = true;
    showNote("");
    setDraft({ lat: x.lat, lng: x.lng, name: x.name });
    status("Lieu choisi : ajoute l'étape (heure facultative).");
  });

  /* Position actuelle */
  $(root, "#eloc").onclick = () => {
    if (!navigator.geolocation) return fail(new Error("Géolocalisation non supportée"));
    status("Recherche de ta position…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!time.value) time.value = nowHm();
        await setDraft({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        status("Position trouvée : vérifie le nom puis « Ajouter l'étape ».");
        name.focus();
      },
      (err) => fail(new Error("Position indisponible : " + err.message)),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  /* Choix sur la carte : un appui pose le point */
  $(root, "#epmap").onclick = async () => {
    let L;
    try { L = await loadLeaflet(); } catch (err) { return fail(err); }
    const ov = document.createElement("div");
    ov.className = "mappick";
    ov.innerHTML = `<div class="mappick-bar"><button type="button" id="mpcancel">✕ Annuler</button><span>Touche la carte pour poser le point</span><button type="button" id="mpok" class="primary" disabled>Valider</button></div><div id="mpmap"></div>`;
    document.body.appendChild(ov);
    const draft = parseCoords(lat.value, lng.value) || e.places.at(-1);
    const map = L.map(ov.querySelector("#mpmap"));
    addTiles(L, map);
    if (draft) map.setView([draft.lat, draft.lng], 11);
    else map.setView([-41.2, 173.3], 5);
    let marker = null, pt = null;
    const ok = ov.querySelector("#mpok");
    map.on("click", (ev) => {
      pt = ev.latlng;
      if (marker) marker.setLatLng(pt);
      else marker = L.marker(pt).addTo(map);
      ok.disabled = false;
    });
    const closeMap = () => { map.remove(); ov.remove(); };
    ov.querySelector("#mpcancel").onclick = closeMap;
    ok.onclick = () => { const p = pt; closeMap(); if (p) setDraft({ lat: p.lat, lng: p.lng }); };
  };

  /* ----- Aperçu « comme un visiteur » : rendu public de l'état actuel du formulaire, sans rien enregistrer ----- */

  $(root, "#epreview").onclick = () => {
    const dateVal = $(root, "#edate").value;
    const view = {
      ...JSON.parse(JSON.stringify(e)),
      title: $(root, "#etitle").value.trim(),
      text: $(root, "#etext").value,
      date: /^\d{4}-\d{2}-\d{2}$/.test(dateVal) ? dateVal : date,
    };
    // L'itinéraire routier est calculé par le serveur à l'enregistrement : s'il ne correspond plus aux étapes, on ne l'affiche pas.
    const sig = view.places.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(";");
    if (view.route?.sig !== sig) delete view.route;
    const pv = document.createElement("div");
    pv.className = "sheet preview";
    pv.innerHTML = `
      <div class="sheet-inner">
        <div class="sheet-bar">
          <button type="button" id="pvclose">← Retour à l'éditeur</button>
          <span class="muted">Aperçu · rien n'est enregistré</span>
        </div>
        ${$(root, "#edraft").checked ? `<p class="draftnote">✎ Brouillon : les visiteurs ne verront pas ce jour tant que la case est cochée.</p>` : ""}
        <article>${renderDayArticle(view, acts)}</article>
        ${view.places.length > 1 && view.routeMode === "drive" && !view.route ? `<p class="muted">Le tracé en voiture est calculé à l'enregistrement (lignes droites en attendant).</p>` : ""}
      </div>`;
    document.body.appendChild(pv);
    updateLock();
    pv.querySelectorAll(".stoplink").forEach((b) => (b.disabled = true));
    const maps = initDayMaps(pv, view, acts);
    const closePreview = () => {
      maps.remove();
      pv.remove();
      cleanups.splice(cleanups.indexOf(closePreview), 1);
      updateLock();
    };
    cleanups.push(closePreview);
    pv.querySelector("#pvclose").onclick = closePreview;
  };

  /* ----- Enregistrer / supprimer / annuler ----- */

  $(root, "#esave").onclick = async () => {
    if (queue.some((x) => x.state !== "fail")) return fail(new Error("Des médias sont encore en cours d'envoi : attends la fin ou retire-les."));
    const failed = queue.filter((x) => x.state === "fail");
    if (failed.length && !confirm(`${failed.length} média(s) n'ont pas pu être envoyés. Enregistrer le jour sans eux ?`)) return;
    if (!addPlace()) return;
    e.title = $(root, "#etitle").value.trim();
    e.text = $(root, "#etext").value;
    e.draft = $(root, "#edraft").checked;
    const newDate = $(root, "#edate").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return fail(new Error("Date invalide."));
    if (newDate !== date) e.moveTo = newDate;
    else delete e.moveTo;
    const btn = $(root, "#esave");
    btn.disabled = true;
    status("Enregistrement…");
    try {
      await api(`/entries/${date}`, { method: "PUT", body: e });
      drafts.clear(date); // enregistré : le brouillon local n'a plus de raison d'être
      close();
      await onDone(newDate);
    } catch (err) {
      btn.disabled = false;
      fail(err);
    }
  };

  $(root, "#edel")?.addEventListener("click", async () => {
    if (!confirm("Supprimer définitivement ce jour et ses médias ?")) return;
    try {
      await api(`/entries/${date}`, { method: "DELETE" });
      drafts.clear(date);
      close();
      await onDone(null);
    } catch (err) {
      fail(err);
    }
  });

  $(root, "#ecancel").onclick = () => {
    if (isDirty() && !confirm("Abandonner les modifications non enregistrées ? Le brouillon local sera effacé.")) return;
    if (rec) rec.stop();
    drafts.clear(date); // annulation explicite
    close();
  };
}
