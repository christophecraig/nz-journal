import { api, esc, mediaUrl, fmtLong, setToken, loadLeaflet, addTiles } from "./common.js";

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

export function openEditor({ date, entry, onDone }) {
  const e = entry
    ? structuredClone(entry)
    : { date, title: "", text: "", photos: [], audios: [], videos: [], places: [], routeMode: "drive" };

  e.places = e.places || [];
  e.routeMode = e.routeMode === "none" ? "none" : "drive";
  for (const p of e.places) if (!p.id) p.id = newId();
  const root = document.createElement("div");
  root.className = "editor";
  root.innerHTML = `
    <div class="sheet-inner">
      <div class="sheet-bar">
        <button type="button" id="ecancel">✕ Annuler</button>
        <button type="button" id="esave" class="primary">Enregistrer</button>
      </div>
      <p class="kicker">${esc(fmtLong(date))}</p>
      <p id="estatus" class="status" role="status"></p>

      <label>Titre
        <input id="etitle" maxlength="200" placeholder="Ex. Arrivée à Wellington" value="${esc(e.title)}">
      </label>

      <label>Récit du jour
        <textarea id="etext" rows="10" placeholder="Ce qu'on a fait, vu, mangé, ressenti…">${esc(e.text)}</textarea>
        <small>Markdown : **gras**, *italique*, - liste, # titre, [texte](https://lien)</small>
      </label>

      <fieldset>
        <legend>Photos</legend>
        <div id="ephotos" class="thumbs"></div>
        <label class="btn">＋ Ajouter des photos<input id="efile" type="file" accept="image/*" multiple hidden></label>
      </fieldset>

      <fieldset>
        <legend>Notes vocales</legend>
        <div id="eaudios"></div>
        <div class="row">
          <button type="button" id="erec">● Enregistrer</button>
          <label class="btn">Importer un audio<input id="eaudiofile" type="file" accept="audio/*" hidden></label>
        </div>
        <small>5 Mo max par note (environ 10 à 15 min en enregistrement direct).</small>
      </fieldset>

      <fieldset>
        <legend>Vidéos (par lien)</legend>
        <div id="evideos"></div>
        <div class="row">
          <input id="evurl" type="url" placeholder="https://youtu.be/…  (YouTube, Vimeo ou .mp4)">
          <button type="button" id="evadd">Ajouter</button>
        </div>
        <small>Mets ta vidéo en « non répertoriée » sur YouTube, puis colle le lien ici.</small>
      </fieldset>

      <fieldset>
        <legend>Étapes du jour</legend>
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
      </fieldset>

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
  const close = () => {
    root.remove();
    updateLock();
  };

  /* ----- Rendu des listes ----- */

  const photosEl = $(root, "#ephotos");
  const renderPhotos = () => {
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

  const videosEl = $(root, "#evideos");
  const renderVideos = () => {
    videosEl.innerHTML = e.videos
      .map((v, i) => `<div class="item" data-i="${i}"><span class="grow">${esc(v.url)}</span><button type="button" data-act="del">✕</button></div>`)
      .join("");
  };
  videosEl.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-act=del]");
    if (b) { e.videos.splice(Number(b.closest(".item").dataset.i), 1); renderVideos(); }
  });

  const placesEl = $(root, "#eplaces");
  const renderPlaces = () => {
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

  renderPhotos(); renderAudios(); renderVideos(); renderPlaces();

  /* ----- Photos ----- */

  $(root, "#efile").onchange = async (ev) => {
    const files = [...ev.target.files];
    ev.target.value = "";
    for (let i = 0; i < files.length; i++) {
      status(`Photo ${i + 1}/${files.length} en cours d'envoi…`);
      try {
        const bmp = await createImageBitmap(files[i], { imageOrientation: "from-image" });
        const full = await scaleImage(bmp, 1600, 0.82);
        const thumb = await scaleImage(bmp, 420, 0.7);
        bmp.close?.();
        const a = await upload(full, "image/jpeg");
        const b = await upload(thumb, "image/jpeg");
        e.photos.push({ key: a.key, thumb: b.key, caption: "" });
        renderPhotos();
      } catch (err) {
        return fail(new Error(`Photo ${i + 1} : ${err.message}`));
      }
    }
    status("Photos ajoutées. N'oublie pas d'enregistrer.");
  };

  /* ----- Audio ----- */

  async function addAudio(blob, type, label) {
    if (blob.size > MAX_BYTES) return fail(new Error("Audio trop lourd (max ~5 Mo)"));
    status("Envoi de la note vocale…");
    try {
      const { key } = await upload(blob, type);
      e.audios.push({ key, label });
      renderAudios();
      status("Note vocale ajoutée. N'oublie pas d'enregistrer.");
    } catch (err) {
      fail(err);
    }
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

  /* ----- Vidéos ----- */

  const addVideo = () => {
    const input = $(root, "#evurl");
    const url = input.value.trim();
    if (!url) return true;
    if (!/^https?:\/\//i.test(url)) { fail(new Error("Le lien doit commencer par http(s)://")); return false; }
    e.videos.push({ url, title: "" });
    input.value = "";
    renderVideos();
    return true;
  };
  $(root, "#evadd").onclick = addVideo;

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

  /* ----- Enregistrer / supprimer / annuler ----- */

  $(root, "#esave").onclick = async () => {
    if (!addVideo() || !addPlace()) return;
    e.title = $(root, "#etitle").value.trim();
    e.text = $(root, "#etext").value;
    const btn = $(root, "#esave");
    btn.disabled = true;
    status("Enregistrement…");
    try {
      await api(`/entries/${date}`, { method: "PUT", body: e });
      close();
      await onDone(date);
    } catch (err) {
      btn.disabled = false;
      fail(err);
    }
  };

  $(root, "#edel")?.addEventListener("click", async () => {
    if (!confirm("Supprimer définitivement ce jour et ses médias ?")) return;
    try {
      await api(`/entries/${date}`, { method: "DELETE" });
      close();
      await onDone(null);
    } catch (err) {
      fail(err);
    }
  });

  $(root, "#ecancel").onclick = () => {
    if (rec) rec.stop();
    close();
  };
}
