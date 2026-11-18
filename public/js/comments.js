import { CONFIG } from "./config.js";
import { api, esc, dayFromUrl, dayPath } from "./common.js";

export const commentsEnabled = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const RETURN_KEY = "nz_return";
let clientPromise = null;

/** Client Supabase, chargé seulement quand un visiteur ouvre un jour (rien n'est téléchargé sinon). */
function getClient() {
  clientPromise ||= import(SUPABASE_JS)
    .then(({ createClient }) =>
      createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
        // PKCE : le retour de Google arrive dans ?code=… et ne touche pas au #jour du site
        auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    )
    .catch((e) => {
      clientPromise = null;
      throw e;
    });
  return clientPromise;
}

/** À appeler au démarrage : termine la connexion Google puis ramène le visiteur sur le jour qu'il lisait. */
export async function finishAuthRedirect() {
  if (!commentsEnabled()) return;
  const q = new URLSearchParams(location.search);
  if (!q.has("code") && !q.has("error_description")) return;
  try {
    const c = await getClient();
    await c.auth.getSession(); // attend l'échange du code
  } catch {
    /* le visiteur pourra réessayer */
  }
  let back = "";
  try {
    back = sessionStorage.getItem(RETURN_KEY) || "";
    sessionStorage.removeItem(RETURN_KEY);
  } catch {}
  // On reprend le jour que le visiteur lisait. Public : /jour/DATE (ou ancien #DATE) ; admin : on reste sur /admin#DATE.
  const i = back.indexOf("#");
  const hash = i >= 0 ? back.slice(i) : "";
  const path = i >= 0 ? back.slice(0, i) : back;
  if (location.pathname.startsWith("/admin")) {
    history.replaceState(null, "", location.pathname + (/^#\d{4}-\d{2}-\d{2}$/.test(hash) ? hash : ""));
  } else {
    const day = dayFromUrl(location.pathname, "") || dayFromUrl(path, hash);
    history.replaceState(null, "", day ? dayPath(day) : location.pathname);
  }
}

/** Admin : les derniers commentaires, tous jours confondus (lecture publique, la même que celle des visiteurs). */
export async function recentComments(limit = 40) {
  if (!commentsEnabled()) return [];
  const c = await getClient().catch(() => { throw new Error("Les commentaires sont indisponibles pour le moment."); });
  const { data, error } = await c
    .from("comments")
    .select("id, day, body, created_at, profiles(display_name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Impossible de charger les commentaires.");
  return data || [];
}

const fmtWhen = (iso) =>
  new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const FRIENDLY = [
  [/invalid login credentials/i, "E-mail ou mot de passe incorrect."],
  [/already registered|already been registered/i, "Un compte existe déjà avec cet e-mail : connecte-toi."],
  [/password should be at least|weak/i, "Mot de passe trop court (8 caractères minimum)."],
  [/rate limit|too many/i, "Trop de tentatives : réessaie dans un moment."],
  [/provider is not enabled|unsupported provider/i, "La connexion Google n'est pas encore activée."],
];
const friendly = (m) => (FRIENDLY.find(([re]) => re.test(m || "")) || [null, m || "Une erreur est survenue."])[1];

export async function mountComments(el, date, { admin = false } = {}) {
  if (!commentsEnabled() || !el) return;
  el.dataset.date = date;
  el.innerHTML = `<h3>Commentaires</h3><div class="clist muted">Chargement…</div><div class="cform"></div>`;
  const list = el.querySelector(".clist");
  const form = el.querySelector(".cform");
  const alive = () => el.isConnected && el.dataset.date === date;
  let client;
  try {
    client = await getClient();
  } catch {
    if (alive()) el.innerHTML = `<h3>Commentaires</h3><p class="muted">Les commentaires sont indisponibles pour le moment.</p>`;
    return;
  }
  if (!alive()) return;

  let session = null;
  let profile = null;
  let comments = [];
  let msg = "";
  const setMsg = (m) => { msg = m; paintForm(); };

  async function loadComments() {
    const { data, error } = await client
      .from("comments")
      .select("id, user_id, body, created_at, profiles(display_name)")
      .eq("day", date)
      .order("created_at", { ascending: true });
    if (!alive()) return;
    if (error) { list.textContent = "Impossible de charger les commentaires."; return; }
    comments = data || [];
    paintList();
  }

  async function loadSession() {
    const { data } = await client.auth.getSession();
    session = data?.session || null;
    profile = null;
    if (session) {
      const { data: p } = await client.from("profiles").select("display_name").eq("user_id", session.user.id).maybeSingle();
      profile = p || null;
    }
    if (alive()) paintForm();
  }

  function paintList() {
    if (!comments.length) { list.innerHTML = `<p class="muted">Pas encore de commentaire. Sois le premier !</p>`; return; }
    list.innerHTML = comments
      .map((c) => {
        const mine = session && c.user_id === session.user.id;
        return `<article class="comment" data-id="${esc(c.id)}">
          <header><strong>${esc(c.profiles?.display_name || "Anonyme")}</strong> <span class="muted">${esc(fmtWhen(c.created_at))}</span>
          ${mine || admin ? `<button type="button" class="cdel" title="Supprimer">✕</button>` : ""}</header>
          <p>${esc(c.body)}</p>
        </article>`;
      })
      .join("");
  }

  function paintForm() {
    const note = msg ? `<p class="cmsg">${esc(msg)}</p>` : "";
    if (!session) {
      form.innerHTML = `
        <p class="muted">Lire est libre. Pour commenter, identifie-toi :</p>
        ${CONFIG.google ? `<button type="button" class="primary" data-act="google">Continuer avec Google</button>` : ""}
        ${CONFIG.emailPassword ? `<form class="cauth" data-act="emailform">
          <input name="email" type="email" required autocomplete="email" placeholder="E-mail" maxlength="200">
          <input name="password" type="password" required minlength="8" autocomplete="current-password" placeholder="Mot de passe (8 caractères min.)" maxlength="200">
          <div class="row"><button type="submit" data-mode="signin">Se connecter</button><button type="submit" data-mode="signup">Créer un compte</button></div>
          <small class="muted">Aucun e-mail ne t'est envoyé. Garde bien ton mot de passe : sans e-mail de récupération, il n'est pas récupérable (utilise Google si tu hésites).</small>
        </form>` : ""}
        ${note}`;
      return;
    }
    if (!profile) {
      const meta = session.user.user_metadata || {};
      const guess = String(meta.given_name || meta.full_name || meta.name || "").split(" ")[0].slice(0, 40);
      form.innerHTML = `
        <form class="cauth" data-act="nameform">
          <label>Comment doit-on t'appeler ? <input name="name" required maxlength="40" value="${esc(guess)}" placeholder="Ton prénom"></label>
          <div class="row"><button type="submit" class="primary">Valider</button><button type="button" data-act="logout">Annuler</button></div>
        </form>${note}`;
      return;
    }
    form.innerHTML = `
      <form class="cauth" data-act="postform">
        <textarea name="body" rows="3" maxlength="1000" required placeholder="Ton commentaire…"></textarea>
        <div class="row"><button type="submit" class="primary">Publier</button>
        <span class="muted grow">${esc(profile.display_name)} · <button type="button" class="linklike" data-act="logout">Se déconnecter</button></span></div>
      </form>${note}`;
  }

  list.addEventListener("click", async (ev) => {
    const b = ev.target.closest(".cdel");
    if (!b || !confirm("Supprimer ce commentaire ?")) return;
    const id = b.closest(".comment").dataset.id;
    try {
      const mine = comments.find((c) => c.id === id)?.user_id === session?.user.id;
      if (mine) {
        const { error } = await client.from("comments").delete().eq("id", id);
        if (error) throw error;
      } else await api(`/comments/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadComments();
    } catch (e) {
      setMsg(friendly(e.message));
    }
  });

  form.addEventListener("click", async (ev) => {
    const act = ev.target.closest("[data-act]")?.dataset.act;
    if (act === "google") {
      try { sessionStorage.setItem(RETURN_KEY, location.pathname + location.hash); } catch {}
      const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
      if (error) setMsg(friendly(error.message));
    }
    if (act === "logout") {
      await client.auth.signOut();
      msg = "";
      await loadSession();
      await loadComments();
    }
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const act = f.dataset.act;
    const fd = new FormData(f);
    const btns = f.querySelectorAll("button");
    btns.forEach((b) => (b.disabled = true));
    try {
      if (act === "emailform") {
        const email = String(fd.get("email")).trim();
        const password = String(fd.get("password"));
        const signup = ev.submitter?.dataset.mode === "signup";
        const { data, error } = signup ? await client.auth.signUp({ email, password }) : await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (signup && !data.session) throw new Error("Inscription impossible pour le moment. Utilise Google, ou réessaie plus tard.");
        msg = "";
        await loadSession();
        await loadComments();
      } else if (act === "nameform") {
        const display_name = String(fd.get("name")).trim().slice(0, 40);
        if (!display_name) throw new Error("Indique un prénom.");
        const { error } = await client.from("profiles").upsert({ user_id: session.user.id, display_name });
        if (error) throw error;
        msg = "";
        await loadSession();
        await loadComments();
      } else if (act === "postform") {
        const body = String(fd.get("body")).trim();
        if (!body) throw new Error("Écris quelque chose.");
        const { error } = await client.from("comments").insert({ day: date, body });
        if (error) throw error;
        msg = "";
        await loadComments();
        f.reset();
      }
    } catch (e) {
      msg = friendly(e.message);
    }
    if (!alive()) return;
    if (act === "postform") {
      // on garde le texte tapé : seul le message change
      btns.forEach((b) => (b.disabled = false));
      let n = form.querySelector(".cmsg");
      if (!n && msg) { n = document.createElement("p"); n.className = "cmsg"; form.appendChild(n); }
      if (n) n.textContent = msg;
      return;
    }
    paintForm();
  });

  await loadSession();
  await loadComments();
}
