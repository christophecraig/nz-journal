import { api, esc, mediaUrl, fmtLong, setToken } from "./common.js";

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

export function openEditor({ date, entry, onDone }) {
  const e = entry
    ? structuredClone(entry)
    : { date, title: "", text: "", photos: [], audios: [], videos: [], places: [] };

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
        <legend>Lieux</legend>
        <div id="eplaces"></div>
        <div class="row wrap">
          <input id="epname" placeholder="Nom du lieu" maxlength="120">
          <input id="eplat" placeholder="Latitude (ou « lat, lng »)" inputmode="text">
          <input id="eplng" placeholder="Longitude" inputmode="text">
        </div>
        <div class="row">
          <button type="button" id="eloc">📍 Ma position</button>
          <button type="button" id="epadd">Ajouter le lieu</button>
        </div>
        <small>Astuce : dans Google Maps, un appui long sur la carte donne les coordonnées à coller ici.</small>
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
      .map((p, i) => `<div class="item" data-i="${i}"><span class="grow">📍 ${esc(p.name)} <span class="muted">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</span></span><button type="button" data-act="del">✕</button></div>`)
      .join("");
  };
  placesEl.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-act=del]");
    if (b) { e.places.splice(Number(b.closest(".item").dataset.i), 1); renderPlaces(); }
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

  const addPlace = () => {
    const lat = $(root, "#eplat"), lng = $(root, "#eplng"), name = $(root, "#epname");
    if (!lat.value.trim() && !lng.value.trim()) return true;
    const c = parseCoords(lat.value, lng.value);
    if (!c) { fail(new Error("Coordonnées invalides (ex. -41.2865, 174.7762)")); return false; }
    e.places.push({ name: name.value.trim() || "Lieu", ...c });
    name.value = lat.value = lng.value = "";
    renderPlaces();
    return true;
  };
  $(root, "#epadd").onclick = addPlace;
  $(root, "#eloc").onclick = () => {
    if (!navigator.geolocation) return fail(new Error("Géolocalisation non supportée"));
    status("Recherche de ta position…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        $(root, "#eplat").value = pos.coords.latitude.toFixed(5);
        $(root, "#eplng").value = pos.coords.longitude.toFixed(5);
        status("Position trouvée : donne un nom au lieu puis « Ajouter le lieu ».");
        $(root, "#epname").focus();
      },
      (err) => fail(new Error("Position indisponible : " + err.message)),
      { enableHighAccuracy: true, timeout: 15000 }
    );
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
