/* social.js — se carga DESPUÉS de app.js y reutiliza su `supabaseClient`.
   No cambia el registro, el login ni el perfil de app.js. */
(() => {
  const sb = supabaseClient;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text; // textContent: nunca HTML de otros usuarios
    return n;
  };

  const community = $("community");
  const enter = $("enter-community");
  const toastBox = $("c-toast");
  let me = null;
  let deck = [];
  let current = null; // coincidencia abierta en el chat
  let channel = null;
  let seen = new Set();
  let toastTimer;
  let banner = null; // aviso de perfil incompleto en Descubrir
  let stories = null; // fila de estados arriba de Descubrir
  let countryFilter = null; // país elegido en el botón del mundo
  let access = null; // estado de la prueba gratuita y la suscripción
  let accessTimer = null;
  let view = "discover"; // pantalla abierta

  function say(msg) {
    toastBox.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastBox.textContent = ""), 3500);
  }

  const BLOCK_MSG = "No se permite compartir teléfonos, redes sociales, correos o enlaces, ni pedir dinero.";
  const isBlocked = (e) => !!e && String(e.message || "").includes("contenido_no_permitido");
  const INTENTS = { estable: "Relación estable", serio: "Compromiso serio", viajar: "Viajar juntos", familia: "Formar familia", otro_pais: "Vivir en otro país", conocernos: "Conocernos primero" };
  const SVG_OPEN = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  const ICON_CAM = SVG_OPEN + '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  const ICON_SEND = SVG_OPEN + '<path d="M4 12l16-8-6 16-3-7z"/></svg>';

  function avatar(path, name, extra) {
    const box = el("div", "c-av " + (extra || ""));
    if (path) {
      const img = document.createElement("img");
      img.src = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      img.alt = "";
      img.loading = "lazy";
      box.append(img);
    } else {
      box.textContent = (name || "?").trim().charAt(0).toUpperCase() || "?";
    }
    return box;
  }

  /* ---------- Sesión ---------- */
  async function refreshSession() {
    const { data } = await sb.auth.getSession();
    me = data.session?.user || null;
    enter.style.display = me ? "" : "none";
    if (!me) closeCommunity();
    startNotifications();
    const footerAccount = $("footer-account");
    if (footerAccount) footerAccount.hidden = !me;
  }

  // Copia nombre, país, descripción y foto desde user_metadata a la tabla profiles
  async function syncProfile() {
    const { data } = await sb.auth.getUser();
    const u = data.user;
    if (!u) return;
    const m = u.user_metadata || {};
    const patch = {};
    if (m.full_name) patch.full_name = m.full_name;
    if (m.country !== undefined) patch.country = m.country || null;
    if (m.description !== undefined) patch.description = m.description || null;
    if (m.avatar_path) patch.avatar_path = m.avatar_path;
    if (m.intent) patch.intent = m.intent;
    if (Object.keys(patch).length) {
      const { error } = await sb.from("profiles").update(patch).eq("id", u.id);
      if (error) {
        console.error("No se pudo sincronizar el perfil:", error);
        if (isBlocked(error)) alert("Tu descripción no puede incluir teléfonos, redes sociales, correos o enlaces, ni pedir dinero. Edítala en Mi perfil.");
      }
    }
  }

  sb.auth.onAuthStateChange((event) => {
    setTimeout(() => {
      refreshSession();
      if (event === "USER_UPDATED") syncProfile();
      if (event === "SIGNED_IN") $("login-dialog")?.close();
    }, 0);
  });
  refreshSession();

  /* ---------- Navegación ---------- */
  // Vista y pestaña de Estados: se crean aquí para no tocar index.html
  const vStatus = el("div", "c-view");
  vStatus.id = "v-status";
  vStatus.hidden = true;
  $("v-chat").after(vStatus);
  const statusTab = el("button", "", "Estados");
  statusTab.type = "button";
  statusTab.dataset.tab = "status";
  community.querySelector('.c-tabs button[data-tab="matches"]').after(statusTab);

  const vPlans = el("div", "c-view");
  vPlans.id = "v-plans";
  vPlans.hidden = true;
  vStatus.after(vPlans);
  const vWall = el("div", "c-view");
  vWall.id = "v-wall";
  vWall.hidden = true;
  vStatus.after(vWall);
  const vWorld = el("div", "c-view");
  vWorld.id = "v-world";
  vWorld.hidden = true;
  vStatus.after(vWorld);
  const wallTab = el("button", "", "Muro");
  wallTab.type = "button";
  wallTab.dataset.tab = "wall";
  community.querySelector('.c-tabs button[data-tab="discover"]').after(wallTab);

  const views = { discover: $("v-discover"), matches: $("v-matches"), chat: $("v-chat"), status: vStatus, plans: vPlans, wall: vWall, world: vWorld };
  const titles = { discover: "Descubrir", matches: "Chat", status: "Estados", plans: "Planes", wall: "Muro", world: "Explorar el mundo" };

  const TAB_ICONS = {
    discover: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 6-4 0 2-6z"/>',
    matches: '<path d="M5 5h14v10H9l-4 4z"/>',
    wall: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10h8M8 14h5"/>',
    status: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4-6 8-6s7 2 8 6"/>'
  };
  const setTab = (btn, d, label) => {
    if (!btn) return;
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg><span>" + label + "</span>";
  };
  setTab(community.querySelector('.c-tabs button[data-tab="discover"]'), TAB_ICONS.discover, "Descubrir");
  setTab(community.querySelector('.c-tabs button[data-tab="matches"]'), TAB_ICONS.matches, "Chat");
  setTab(statusTab, TAB_ICONS.status, "Estados");
  setTab(wallTab, TAB_ICONS.wall, "Muro");
  setTab($("c-profile"), TAB_ICONS.profile, "Perfil");

  // Barra de escritura: vive justo encima de los botones de abajo y crece hacia arriba
  const dockHost = el("div", "c-dockhost");
  dockHost.hidden = true;
  community.insertBefore(dockHost, community.querySelector(".c-tabs"));
  const setDock = (node) => { dockHost.replaceChildren(node); dockHost.hidden = false; };
  const clearDock = () => { dockHost.replaceChildren(); dockHost.hidden = true; };

  function leaveChat() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    current = null;
    $("c-menu").hidden = true;
    $("c-more").hidden = true;
  }

  function showView(name) {
    view = name;
    if (name === "chat") setDock(chatDock); else clearDock();
    Object.entries(views).forEach(([k, v]) => (v.hidden = k !== name));
    $("c-title").textContent = titles[name] || (current ? current.full_name : "Chat");
    document.querySelectorAll(".c-tabs button[data-tab]").forEach((b) => {
      if (b.dataset.tab === name || (name === "chat" && b.dataset.tab === "matches")) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
  }

  function showTab(name) {
    leaveChat();
    showView(name);
    if (name === "discover") loadDiscover();
    if (name === "matches") loadMatches();
    if (name === "status") loadStatuses();
    if (name === "plans") loadPlans();
    if (name === "wall") loadWall();
    if (name === "world") loadWorld();
  }

  function closeCommunity() {
    leaveChat();
    clearInterval(accessTimer);
    community.hidden = true;
    document.body.style.overflow = "";
  }

  enter.addEventListener("click", async () => {
    await syncProfile();
    loadAccess();
    cleanupExpiredStatuses();
    cleanupExpiredPosts();
    maybeOnboard();
    community.hidden = false;
    document.body.style.overflow = "hidden";
    showTab("discover");
  });

  $("c-home").addEventListener("click", () => {
    if (current) showTab("matches");
    else if (view === "plans" || view === "world") showTab("discover");
    else closeCommunity();
  });
  community.querySelectorAll(".c-tabs button[data-tab]").forEach((b) =>
    b.addEventListener("click", () => showTab(b.dataset.tab))
  );
  $("c-profile").addEventListener("click", () => { closeCommunity(); $("profile").click(); });

  /* ---------- Descubrir ---------- */
  async function loadDiscover() {
    const box = views.discover;
    box.replaceChildren(el("p", "c-empty", "Buscando perfiles…"));
    const { data, error } = await sb.rpc("get_discover_profiles", { p_country: countryFilter }).limit(30);
    if (error) {
      console.error(error);
      box.replaceChildren(el("p", "c-empty", "No se pudieron cargar los perfiles. Inténtalo de nuevo."));
      return;
    }
    deck = data || [];
    if (deck.length) {
      const { data: st } = await sb.rpc("get_active_statuses").select("id,user_id,body,image_path").in("user_id", deck.map((p) => p.id));
      const map = new Map((st || []).map((s) => [s.user_id, s]));
      deck.forEach((p) => {
        const s = map.get(p.id);
        p.statusRow = s || null;
        p.status = s ? s.body : "";
        p.statusImage = s ? s.image_path : "";
      });
    }
    banner = await profileBanner();
    stories = await storiesBar();
    renderCard();
  }

  // Fila de estados (como historias) arriba de Descubrir
  async function storiesBar() {
    const row = el("div", "c-stories");
    const mine = el("button", "c-story");
    mine.type = "button";
    mine.append(el("div", "c-av c-plus", "+"), el("span", "", "Tu estado"));
    mine.onclick = () => showTab("status");
    row.append(mine);
    try {
      const { data } = await sb.rpc("get_active_statuses").select("user_id,full_name,avatar_path").limit(20);
      (data || []).filter((s) => s.user_id !== me.id).forEach((s) => {
        const b = el("button", "c-story");
        b.type = "button";
        b.append(avatar(s.avatar_path, s.full_name), el("span", "", (s.full_name || "").split(" ")[0]));
        b.onclick = () => showTab("status");
        row.append(b);
      });
    } catch (e) { console.error(e); }
    return row;
  }

  // Avisa si al perfil le falta algo y explica por qué no aparece en Descubrir
  async function profileBanner() {
    const { data: me_ } = await sb.from("profiles").select("full_name,country,description,avatar_path").eq("id", me.id).single();
    if (!me_) return null;
    const labels = { full_name: "nombre", country: "país", description: "descripción", avatar_path: "foto" };
    const missing = Object.keys(labels).filter((k) => !me_[k] || !String(me_[k]).trim());
    if (!missing.length) return null;
    const pct = Math.round(((4 - missing.length) / 4) * 100);
    const box = el("div", "c-banner");
    let txt = "Tu perfil está al " + pct + " %. Falta: " + missing.map((k) => labels[k]).join(", ") + ".";
    if (missing.includes("avatar_path") || missing.includes("description")) txt += " Mientras falte la foto o la descripción, no apareces en Descubrir.";
    box.append(el("p", "", txt));
    const go = el("button", "c-btn gold", "Completar perfil");
    go.type = "button";
    go.onclick = () => { closeCommunity(); $("profile").click(); };
    box.append(go);
    return box;
  }

  const worldBtn = el("button", "c-world");
  worldBtn.type = "button";
  worldBtn.addEventListener("click", () => showTab("world"));
  function paintWorld() {
    worldBtn.innerHTML = SVG_OPEN + '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>';
    worldBtn.append(el("span", "", countryFilter ? countryFilter : "Todo el mundo"));
  }
  paintWorld();
  const top = () => [...(banner ? [banner] : []), worldBtn, ...(stories ? [stories] : [])];

  function renderCard() {
    const box = views.discover;
    const p = deck[0];
    if (!p) {
      const empty = el("div", "c-empty");
      empty.append(el("p", "", countryFilter ? "No hay más personas de " + countryFilter + " por ahora." : "Por ahora no hay más perfiles."), el("p", "c-muted", "Vuelve en un rato o invita a alguien que conozcas."));
      const again = el("button", "c-btn gold", "Actualizar");
      again.type = "button";
      again.onclick = loadDiscover;
      empty.append(again);
      if (countryFilter) {
        const all = el("button", "c-btn ghost", "Ver todo el mundo");
        all.type = "button";
        all.onclick = () => { countryFilter = null; paintWorld(); loadDiscover(); };
        empty.append(all);
      }
      box.replaceChildren(...top(), empty);
      return;
    }
    const card = el("article", "c-card full");
    const pics = p.photos && p.photos.length ? p.photos : (p.avatar_path ? [p.avatar_path] : []);
    if (pics.length) {
      const ph = document.createElement("img");
      ph.className = "c-card-photo";
      const dots = pics.length > 1 ? pics.map(() => el("i")) : [];
      let idx = 0;
      const showPic = () => {
        ph.src = sb.storage.from("avatars").getPublicUrl(pics[idx]).data.publicUrl;
        ph.alt = "Foto " + (idx + 1) + " de " + pics.length + " de " + (p.full_name || "perfil");
        dots.forEach((d, i) => d.classList.toggle("on", i === idx));
      };
      card.append(ph);
      if (pics.length > 1) {
        const bar = el("div", "c-dots");
        dots.forEach((d) => bar.append(d));
        card.append(bar);
        card.addEventListener("click", (ev) => {
          const r = card.getBoundingClientRect();
          if (ev.clientY - r.top > r.height * 0.7) return;
          idx = ev.clientX - r.left < r.width / 2 ? (idx - 1 + pics.length) % pics.length : (idx + 1) % pics.length;
          showPic();
        });
      }
      showPic();
    }
    if (p.is_verified) card.append(el("span", "c-badge top", "Identidad verificada"));
    const info = el("div", "c-card-info");
    info.append(el("h2", "", (p.full_name || "Sin nombre") + ", " + p.age));
    if (p.country) info.append(el("p", "c-muted", p.country));
    if (p.intent && INTENTS[p.intent]) info.append(el("span", "c-chip", "Busca: " + INTENTS[p.intent]));
    if (p.description) info.append(el("p", "c-bio", p.description));
    if (p.status || p.statusImage) {
      const st = el("div", "c-status");
      st.append(el("small", "c-muted", "Su estado de hoy"));
      if (p.statusImage) st.append(statusImg(p.statusImage));
      if (p.status) st.append(el("p", "", p.status));
      info.append(st);
    }
    card.append(info);

    const acts = el("div", "c-acts");
    const pass = el("button", "c-btn ghost", "Pasar");
    pass.type = "button";
    pass.onclick = () => { deck.shift(); renderCard(); };
    const like = el("button", "c-btn gold", "Me gusta");
    like.type = "button";
    like.onclick = () => doLike(p, like);
    acts.append(pass, like);
    const rep = el("button", "c-link", "Reportar este perfil");
    rep.type = "button";
    rep.onclick = () => reportUser(p.id, p.statusRow);
    box.replaceChildren(...top(), card, acts, rep);
  }

  async function doLike(p, btn) {
    btn.disabled = true;
    const { error } = await sb.from("likes").insert({ from_user: me.id, to_user: p.id });
    if (error && error.code !== "23505") {
      console.error(error);
      say("No se pudo enviar. Inténtalo de nuevo.");
      btn.disabled = false;
      return;
    }
    const { data } = await sb.rpc("get_my_matches").select("match_id").eq("other_id", p.id).maybeSingle();
    say(data ? "¡Es una coincidencia! Ya pueden escribirse." : "Me gusta enviado.");
    deck.shift();
    renderCard();
  }

  /* ---------- Estados (24 horas) ---------- */
  // Barra de escritura fija abajo: foto, texto y enviar en una misma línea
  function dockedComposer(opts) {
    const wrap = el("div", "c-dockwrap");
    const form = el("form", "c-dock");
    const top = el("div", "c-dock-top");
    const count = el("small", "c-dock-count", "");
    top.append(el("small", "c-dock-hint", opts.hint || ""), count);

    const prevRow = el("div", "c-dock-prev");
    prevRow.hidden = true;
    const prev = document.createElement("img");
    prev.alt = "Vista previa de la foto";
    const clear = el("button", "c-link", "Quitar foto");
    clear.type = "button";
    prevRow.append(prev, clear);

    const row = el("div", "c-dock-row");
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/jpeg,image/png,image/webp";
    file.className = "sr-only";
    const photo = el("label", "c-ibtn");
    photo.setAttribute("aria-label", "Añadir foto");
    photo.innerHTML = ICON_CAM;
    photo.append(file);
    const ta = document.createElement("textarea");
    ta.rows = 1;
    ta.maxLength = opts.max;
    ta.placeholder = opts.placeholder;
    ta.setAttribute("aria-label", opts.label);
    const send = el("button", "c-ibtn gold");
    send.type = "submit";
    send.setAttribute("aria-label", opts.sendLabel);
    send.innerHTML = ICON_SEND;
    row.append(photo, ta, send);
    form.append(top, prevRow, row);
    wrap.append(form);

    ta.addEventListener("input", () => {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
      count.textContent = ta.value.length ? ta.value.length + "/" + opts.max : "";
    });
    file.addEventListener("change", () => {
      if (prev.src && prev.src.startsWith("blob:")) URL.revokeObjectURL(prev.src);
      const f = file.files[0];
      if (f) { prev.src = URL.createObjectURL(f); prevRow.hidden = false; }
      else { prev.removeAttribute("src"); prevRow.hidden = true; }
    });
    clear.addEventListener("click", () => { file.value = ""; file.dispatchEvent(new Event("change")); });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      const f = file.files[0];
      if (!body && !f) { say("Escribe algo o elige una foto."); return; }
      if (f && !["image/jpeg", "image/png", "image/webp"].includes(f.type)) { say("Usa una imagen JPG, PNG o WEBP."); return; }
      if (f && f.size > 5 * 1024 * 1024) { say("La foto no puede superar los 5 MB."); return; }
      send.disabled = true;
      const ok = await opts.onSend(body, f);
      send.disabled = false;
      if (ok) {
        ta.value = ""; ta.style.height = "auto"; count.textContent = "";
        file.value = ""; file.dispatchEvent(new Event("change"));
      }
    });
    return wrap;
  }

  // Borra las publicaciones del muro vencidas (48 h) de la propia persona, con sus fotos
  async function cleanupExpiredPosts() {
    try {
      const { data } = await sb.rpc("purge_my_expired_posts");
      const paths = (data || []).filter(Boolean);
      if (paths.length) await sb.storage.from("avatars").remove(paths);
    } catch (e) { console.error(e); }
  }

  // Borra los estados vencidos de la propia persona (y sus fotos) al entrar
  async function cleanupExpiredStatuses() {
    try {
      const { data } = await sb.from("statuses").select("id,image_path").lt("expires_at", new Date().toISOString());
      if (!data || !data.length) return;
      const paths = data.map((s) => s.image_path).filter(Boolean);
      if (paths.length) await sb.storage.from("avatars").remove(paths);
      await sb.from("statuses").delete().in("id", data.map((s) => s.id));
    } catch (e) { console.error(e); }
  }

  function expiresIn(iso) {
    const h = Math.ceil(24 - (Date.now() - new Date(iso).getTime()) / 3600000);
    return h <= 1 ? "vence en menos de 1 h" : "vence en " + h + " h";
  }

  function statusImg(path) {
    const img = document.createElement("img");
    img.className = "c-st-img";
    img.src = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    img.alt = "Foto del estado";
    img.loading = "lazy";
    return img;
  }

  function timeAgo(iso) {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return "ahora";
    if (m < 60) return "hace " + m + " min";
    return "hace " + Math.floor(m / 60) + " h";
  }

  async function loadStatuses() {
    const box = views.status;
    box.replaceChildren(el("p", "c-empty", "Cargando…"));
    if (!access) await loadAccess();
    const { data, error } = await sb.rpc("get_active_statuses").select("*").order("created_at", { ascending: false }).limit(50);
    if (error) {
      console.error(error);
      box.replaceChildren(el("p", "c-empty", "No se pudieron cargar los estados."));
      return;
    }
    const mine = data.find((s) => s.user_id === me.id);
    const others = data.filter((s) => s.user_id !== me.id);

    // Barra de escritura fija abajo
    const composer = dockedComposer({
      placeholder: "¿Qué quieres contar hoy? (dura 24 h)",
      max: 140,
      label: "Tu estado",
      sendLabel: mine ? "Reemplazar mi estado" : "Publicar estado",
      hint: mine ? "Un estado nuevo reemplaza el actual." : "",
      onSend: async (body, f) => {
        let image_path = null;
        if (f) {
          const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[f.type];
          image_path = me.id + "/status-" + Date.now() + "." + ext;
          const up = await sb.storage.from("avatars").upload(image_path, f, { contentType: f.type, upsert: false });
          if (up.error) { console.error(up.error); say("No se pudo subir la foto."); return false; }
        }
        const { data: created, error: err } = await sb.from("statuses").insert({ body, image_path }).select("id").single();
        if (err) {
          console.error(err);
          if (image_path) await sb.storage.from("avatars").remove([image_path]);
          say(isBlocked(err) ? BLOCK_MSG : "No se pudo publicar tu estado.");
          return false;
        }
        if (mine && mine.image_path) await sb.storage.from("avatars").remove([mine.image_path]);
        await sb.from("statuses").delete().eq("user_id", me.id).neq("id", created.id); // un solo estado activo
        say("Estado publicado por 24 horas.");
        loadStatuses();
        return true;
      },
    });

    const parts = [];

    // Tu estado actual
    if (mine) {
      const card = el("div", "c-mine");
      card.append(el("small", "c-muted", "Tu estado · " + timeAgo(mine.created_at) + " · " + expiresIn(mine.created_at)));
      if (mine.image_path) card.append(statusImg(mine.image_path));
      if (mine.body) card.append(el("p", "", mine.body));
      card.append(commentsToggle(mine));
      const del = el("button", "c-btn ghost", "Eliminar");
      del.type = "button";
      del.addEventListener("click", async () => {
        del.disabled = true;
        if (mine.image_path) await sb.storage.from("avatars").remove([mine.image_path]);
        const { error: err } = await sb.from("statuses").delete().eq("id", mine.id);
        if (err) { console.error(err); say("No se pudo eliminar."); del.disabled = false; return; }
        say("Estado eliminado.");
        loadStatuses();
      });
      card.append(del);
      parts.push(card);
    }

    // Estados de otras personas
    parts.push(el("h3", "c-sub", "De la comunidad"));
    if (!others.length) {
      parts.push(el("p", "c-empty", "Nadie ha publicado un estado hoy."));
    } else {
      const list = el("div", "c-list");
      others.forEach((s) => {
        const row = el("div", "c-row static");
        row.append(avatar(s.avatar_path, s.full_name));
        const t = el("div");
        t.append(el("b", "", s.full_name || "Sin nombre"));
        if (s.body) t.append(el("p", "c-st-text", s.body));
        if (s.image_path) t.append(statusImg(s.image_path));
        t.append(el("small", "", timeAgo(s.created_at)));
        const rep = el("button", "c-link", "Reportar");
        rep.type = "button";
        rep.onclick = () => reportUser(s.user_id, s);
        t.append(rep);
        t.append(commentsToggle(s));
        row.append(t);
        list.append(row);
      });
      parts.push(list);
    }
    box.replaceChildren(...parts);
    if (view === "status") setDock(composer);
  }

  /* ---------- Comentarios del muro (solo con suscripción o en la prueba) ---------- */
  const commentError = (e) => {
    const m = String((e && e.message) || "");
    if (isBlocked(e)) return BLOCK_MSG;
    if (m.includes("comentar_requiere_suscripcion")) return "Comentar requiere suscripción.";
    if (m.includes("limite_comentarios")) return "Llegaste al límite de comentarios de hoy.";
    if (m.includes("estado_no_disponible")) return "Este estado ya no está disponible.";
    if (m.includes("publicacion_no_disponible")) return "Esta publicación ya no está disponible.";
    return "No se pudo comentar.";
  };

  function commentsPanel(status, onCount, kind) {
    const K = kind === "post"
      ? { list: "get_post_comments", arg: "p_post", table: "post_comments", key: "post_id", del: "delete_post_comment" }
      : { list: "get_status_comments", arg: "p_status", table: "status_comments", key: "status_id", del: "delete_status_comment" };
    const box = el("div", "c-comments");
    const list = el("div", "c-clist");
    box.append(list);

    async function load() {
      list.replaceChildren(el("p", "c-muted", "Cargando comentarios…"));
      const { data, error } = await sb.rpc(K.list, { [K.arg]: status.id });
      if (error) { console.error(error); list.replaceChildren(el("p", "c-muted", "No se pudieron cargar los comentarios.")); return; }
      const rows = data || [];
      onCount(rows.length);
      if (!rows.length) { list.replaceChildren(el("p", "c-muted", "Aún no hay comentarios.")); return; }
      list.replaceChildren(...rows.map((c) => {
        const row = el("div", "c-comment");
        row.append(el("b", "", c.full_name || "Sin nombre"), el("p", "", c.body));
        const acts = el("div", "c-cacts");
        row.append(el("small", "c-muted", timeAgo(c.created_at)));
        if (c.user_id !== me.id) {
          const rep = el("button", "c-link", "Reportar");
          rep.type = "button";
          rep.onclick = () => reportUser(c.user_id, null, "Comentario: " + c.body);
          acts.append(rep);
        }
        if (c.user_id === me.id || status.user_id === me.id) {
          const del = el("button", "c-link", "Borrar");
          del.type = "button";
          del.onclick = async () => {
            const { error: err } = await sb.rpc(K.del, { p_comment: c.id });
            if (err) { console.error(err); say("No se pudo borrar el comentario."); return; }
            load();
          };
          acts.append(del);
        }
        row.append(acts);
        return row;
      }));
    }

    if (access && (access.subscribed || access.in_trial)) {
      const form = el("form", "c-cform");
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 300;
      input.placeholder = "Escribe un comentario";
      input.setAttribute("aria-label", "Escribe un comentario");
      input.autocomplete = "off";
      const send = el("button", "c-btn gold", "Comentar");
      send.type = "submit";
      form.append(input, send);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        send.disabled = true;
        const { error } = await sb.from(K.table).insert({ [K.key]: status.id, body });
        send.disabled = false;
        if (error) { console.error(error); say(commentError(error)); return; }
        input.value = "";
        load();
      });
      box.append(form);
    } else {
      const lock = el("div", "c-clock");
      lock.append(el("small", "c-muted", "Solo las personas con suscripción pueden comentar."));
      const plans = el("button", "c-link", "Suscríbete para comentar");
      plans.type = "button";
      plans.onclick = () => showTab("plans");
      lock.append(plans);
      box.append(lock);
    }
    load();
    return box;
  }

  function commentsToggle(status, kind) {
    const wrap = el("div", "c-cwrap");
    const btn = el("button", "c-link", "Comentarios (" + (status.comment_count || 0) + ")");
    btn.type = "button";
    let panel = null;
    btn.addEventListener("click", () => {
      if (panel) { panel.remove(); panel = null; return; }
      panel = commentsPanel(status, (n) => (btn.textContent = "Comentarios (" + n + ")"), kind);
      wrap.append(panel);
    });
    wrap.append(btn);
    return wrap;
  }

  /* ---------- Explorar por país ---------- */
  const norm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  async function loadWorld() {
    const box = views.world;
    box.replaceChildren(el("p", "c-empty", "Cargando países…"));
    const { data, error } = await sb.rpc("get_country_counts");
    if (error) { console.error(error); box.replaceChildren(el("p", "c-empty", "No se pudo cargar la lista de países.")); return; }
    const rows = data || [];
    const total = rows.reduce((n, r) => n + r.people, 0);

    const search = document.createElement("input");
    search.type = "search";
    search.className = "c-search";
    search.placeholder = "Buscar país";
    search.setAttribute("aria-label", "Buscar país");
    const list = el("div", "c-list");

    function item(label, count, value) {
      const b = el("button", "c-row");
      b.type = "button";
      const t = el("div");
      t.append(el("b", "", label), el("small", "", count + (count === 1 ? " persona" : " personas")));
      b.append(t);
      if (value === countryFilter) b.setAttribute("aria-current", "true");
      b.onclick = () => { countryFilter = value; paintWorld(); showTab("discover"); };
      return b;
    }
    function draw(q) {
      const f = norm(q).trim();
      const items = [];
      if (!f) items.push(item("Todo el mundo", total, null));
      rows.filter((r) => !f || norm(r.country).includes(f)).forEach((r) => items.push(item(r.country, r.people, r.country)));
      if (!items.length) items.push(el("p", "c-empty", "Sin resultados."));
      list.replaceChildren(...items);
    }
    search.addEventListener("input", () => draw(search.value));
    draw("");
    box.replaceChildren(el("p", "c-muted", "Elige un país para ver solo a personas de ahí."), search, list);
  }

  /* ---------- Muro de publicaciones ---------- */
  const wallTime = (iso) => {
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
    if (h < 1) return "hace un momento";
    if (h < 24) return "hace " + h + " h";
    const d = Math.floor(h / 24);
    return d === 1 ? "ayer" : "hace " + d + " días";
  };
  const wallLeft = (iso) => {
    const h = Math.ceil(48 - (Date.now() - new Date(iso).getTime()) / 3600000);
    return h <= 1 ? "desaparece en menos de 1 h" : "desaparece en " + h + " h";
  };
  const postError = (e) => isBlocked(e) ? BLOCK_MSG
    : String((e && e.message) || "").includes("limite_publicaciones") ? "Llegaste al límite de publicaciones de hoy."
    : "No se pudo publicar.";

  function wallComposer() {
    return dockedComposer({
      placeholder: "Comparte algo con la comunidad (desaparece en 48 h)",
      max: 500,
      label: "Nueva publicación",
      sendLabel: "Publicar en el muro",
      hint: "",
      onSend: async (body, f) => {
        let image_path = null;
        if (f) {
          const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[f.type];
          image_path = me.id + "/post-" + Date.now() + "." + ext;
          const up = await sb.storage.from("avatars").upload(image_path, f, { contentType: f.type, upsert: false });
          if (up.error) { console.error(up.error); say("No se pudo subir la foto."); return false; }
        }
        const { error } = await sb.from("posts").insert({ body, image_path });
        if (error) {
          console.error(error);
          if (image_path) await sb.storage.from("avatars").remove([image_path]);
          say(postError(error));
          return false;
        }
        say("Publicado en el muro.");
        loadWall();
        return true;
      },
    });
  }

  function wallPost(p) {
    const card = el("article", "c-post");
    const head = el("div", "c-phead");
    const who = el("div");
    who.append(el("b", "", p.full_name || "Sin nombre"), el("small", "c-muted", wallTime(p.created_at) + " · " + wallLeft(p.created_at)));
    head.append(avatar(p.avatar_path, p.full_name), who);
    card.append(head);
    if (p.body) card.append(el("p", "c-pbody", p.body));
    if (p.image_path) card.append(statusImg(p.image_path));

    const acts = el("div", "c-pacts");
    if (p.user_id !== me.id) {
      const rep = el("button", "c-link", "Reportar");
      rep.type = "button";
      rep.onclick = () => reportUser(p.user_id, null, "Publicación: " + (p.body || "") + (p.image_path ? " | foto: " + p.image_path : ""));
      acts.append(rep);
    } else {
      const del = el("button", "c-link", "Borrar publicación");
      del.type = "button";
      del.onclick = async () => {
        if (!confirm("¿Borrar esta publicación y sus comentarios?")) return;
        const { data: path, error } = await sb.rpc("delete_post", { p_post: p.id });
        if (error) { console.error(error); say("No se pudo borrar la publicación."); return; }
        if (path) { try { await sb.storage.from("avatars").remove([path]); } catch (e) { console.error(e); } }
        say("Publicación borrada.");
        loadWall();
      };
      acts.append(del);
    }
    card.append(acts, commentsToggle(p, "post"));
    return card;
  }

  async function loadWall() {
    const box = views.wall;
    box.replaceChildren(el("p", "c-empty", "Cargando…"));
    if (!access) await loadAccess();
    const { data, error } = await sb.rpc("get_wall");
    if (error) { console.error(error); box.replaceChildren(el("p", "c-empty", "No se pudo cargar el muro.")); return; }
    const parts = [];
    const posts = data || [];
    if (!posts.length) parts.push(el("p", "c-empty", "Aún no hay publicaciones. Sé la primera persona en publicar."));
    posts.forEach((p) => parts.push(wallPost(p)));
    box.replaceChildren(...parts);
    if (view === "wall") setDock(wallComposer());
  }

  /* ---------- Coincidencias ---------- */
  const getSeen = (id) => { try { return Number(localStorage.getItem("em_seen_" + id)) || 0; } catch (e) { return 0; } };
  const markSeen = (id) => { try { localStorage.setItem("em_seen_" + id, String(Date.now())); } catch (e) { /* sin almacenamiento */ } };
  function shortTime(iso) {
    const d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    if (Math.floor((now - d) / 86400000) < 2) return "Ayer";
    return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
  }

  async function loadMatches() {
    const box = views.matches;
    box.replaceChildren(el("p", "c-empty", "Cargando…"));
    const { data, error } = await sb.rpc("get_my_matches").select("*");
    if (error) {
      console.error(error);
      box.replaceChildren(el("p", "c-empty", "No se pudieron cargar tus coincidencias."));
      return;
    }
    const all = data || [];
    if (!all.length) {
      box.replaceChildren(el("p", "c-empty", "Aún no tienes coincidencias. Da “Me gusta” en Descubrir."));
      return;
    }
    const fresh = all.filter((m) => !m.last_at);
    const talked = all.filter((m) => m.last_at).sort((a, b) => new Date(b.last_at) - new Date(a.last_at));

    const search = document.createElement("input");
    search.type = "search";
    search.className = "c-search";
    search.placeholder = "Buscar coincidencias";
    search.setAttribute("aria-label", "Buscar coincidencias");
    const holder = el("div");

    function draw(filter) {
      const q = (filter || "").trim().toLowerCase();
      const ok = (m) => !q || (m.full_name || "").toLowerCase().includes(q);
      const kids = [];
      const f = fresh.filter(ok);
      if (f.length) {
        kids.push(el("h3", "c-sub", "Parejas nuevas"));
        const row = el("div", "c-newrow");
        f.forEach((m) => {
          const b = el("button", "c-new");
          b.type = "button";
          b.append(avatar(m.avatar_path, m.full_name), el("span", "", (m.full_name || "Sin nombre").split(" ")[0]));
          b.onclick = () => openChat(m);
          row.append(b);
        });
        kids.push(row);
      }
      const t = talked.filter(ok);
      if (t.length) {
        kids.push(el("h3", "c-sub", "Mensajes"));
        const list = el("div", "c-list");
        t.forEach((m) => {
          const row = el("button", "c-row");
          row.type = "button";
          row.append(avatar(m.avatar_path, m.full_name));
          const preview = m.last_has_image ? (m.last_body ? "Foto · " + m.last_body : "Foto") : (m.last_body || "");
          const txt = el("div");
          txt.append(el("b", "", m.full_name || "Sin nombre"), el("small", "", (m.last_sender === me.id ? "Tú: " : "") + preview));
          row.append(txt);
          const side = el("div", "c-side");
          side.append(el("time", "", shortTime(m.last_at)));
          if (m.last_sender !== me.id && new Date(m.last_at).getTime() > getSeen(m.match_id)) side.append(el("span", "c-dot"));
          row.append(side);
          row.onclick = () => openChat(m);
          list.append(row);
        });
        kids.push(list);
      }
      if (!kids.length) kids.push(el("p", "c-empty", "Sin resultados."));
      holder.replaceChildren(...kids);
    }
    search.addEventListener("input", () => draw(search.value));
    draw("");
    const nc = notifyCard();
    box.replaceChildren(...(nc ? [nc] : []), search, holder);
  }

  /* ---------- Chat ---------- */
  function addMsg(m) {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    const box = $("chat-msgs");
    const bubble = el("div", "c-msg " + (m.sender_id === me.id ? "s" : "r"));
    if (m.image_path) {
      const img = document.createElement("img");
      img.className = "c-msg-img";
      img.alt = "Foto enviada";
      bubble.append(img);
      sb.storage.from("chat-photos").createSignedUrl(m.image_path, 3600).then(({ data }) => {
        if (data) img.src = data.signedUrl;
        box.scrollTop = box.scrollHeight;
      });
    }
    if (m.body) bubble.append(el("span", "", m.body));
    box.append(bubble);
    box.scrollTop = box.scrollHeight;
  }

  async function openChat(m) {
    leaveChat();
    current = m;
    markSeen(m.match_id);
    unread.delete(m.match_id);
    paintUnread();
    seen = new Set();
    $("chat-msgs").replaceChildren();
    $("c-more").hidden = false;
    showView("chat");

    const { data, error } = await sb
      .from("messages")
      .select("id,sender_id,body,image_path,created_at")
      .eq("match_id", m.match_id)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) { console.error(error); say("No se pudieron cargar los mensajes."); return; }
    data.forEach(addMsg);

    channel = sb
      .channel("chat-" + m.match_id)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: "match_id=eq." + m.match_id },
        (payload) => addMsg(payload.new))
      .subscribe();
  }

  $("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("chat-text");
    const body = input.value.trim();
    if (!body || !current) return;
    input.value = "";
    const { data, error } = await sb
      .from("messages")
      .insert({ match_id: current.match_id, sender_id: me.id, body })
      .select("id,sender_id,body,image_path,created_at")
      .single();
    if (error) {
      console.error(error);
      input.value = body;
      say(isBlocked(error) ? BLOCK_MSG : "No se pudo enviar el mensaje.");
      return;
    }
    addMsg(data);
  });

  /* ---------- Bloquear y reportar ---------- */
  async function reportUser(userId, statusRow, extra) {
    const reason = (prompt("Cuéntanos qué pasó (mínimo 3 caracteres):") || "").trim();
    if (reason.length < 3) return;
    const row = { reporter: me.id, reported: userId, reason };
    if (statusRow) {
      row.status_id = statusRow.id;
      row.status_snapshot = ((statusRow.body || "") + (statusRow.image_path ? " | foto: " + statusRow.image_path : "")).slice(0, 1500);
    }
    if (extra) row.status_snapshot = String(extra).slice(0, 1500);
    const { error } = await sb.from("reports").insert(row);
    if (error) { console.error(error); say("No se pudo enviar el reporte."); return; }
    say("Gracias. Revisaremos tu reporte.");
  }

  $("c-more").addEventListener("click", () => ($("c-menu").hidden = !$("c-menu").hidden));

  $("c-block").addEventListener("click", async () => {
    if (!current || !confirm("¿Bloquear a " + (current.full_name || "esta persona") + "? Ya no podrán escribirse.")) return;
    const { error } = await sb.from("blocks").insert({ blocker: me.id, blocked: current.other_id });
    if (error && error.code !== "23505") { console.error(error); say("No se pudo bloquear."); return; }
    say("Persona bloqueada.");
    showTab("matches");
  });

  $("c-report").addEventListener("click", async () => {
    if (!current) return;
    const reason = (prompt("Cuéntanos qué pasó (mínimo 3 caracteres):") || "").trim();
    if (reason.length < 3) return;
    const { error } = await sb.from("reports").insert({ reporter: me.id, reported: current.other_id, reason });
    if (error) { console.error(error); say("No se pudo enviar el reporte."); return; }
    $("c-menu").hidden = true;
    say("Gracias. Revisaremos tu reporte.");
  });

  /* ---------- Prueba gratuita de 48 horas ---------- */
  const accessBar = el("div", "c-access");
  const accessText = el("span", "");
  const accessBtn = el("button", "c-link", "Ver planes");
  accessBtn.type = "button";
  accessBtn.addEventListener("click", () => showTab("plans"));
  accessBar.append(accessText, accessBtn);
  accessBar.hidden = true;
  community.querySelector(".c-top").after(accessBar);

  const fmtDate = (iso) => new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });

  function paintAccess() {
    if (!access) { accessBar.hidden = true; return; }
    accessBar.hidden = false;
    if (access.subscribed) {
      accessBar.className = "c-access";
      accessText.textContent = "Suscripción activa hasta el " + fmtDate(access.subscribed_until) + ".";
      return;
    }
    const left = Math.max(0, Math.floor((new Date(access.trial_ends_at).getTime() - Date.now()) / 1000));
    if (left > 0) {
      accessBar.className = "c-access";
      const photoOpen = new Date(access.trial_ends_at).getTime() - 24 * 3600 * 1000 > Date.now();
      accessText.textContent = "Prueba gratis: te quedan " + Math.floor(left / 3600) + " h " + Math.floor((left % 3600) / 60) + " min · " + (photoOpen ? "Fotos: " + access.photos_left + " de 3." : "Fotos: solo con suscripción.");
    } else {
      accessBar.className = "c-access ended";
      accessText.textContent = "Tu prueba gratuita terminó. Suscríbete para seguir usando fotos y llamadas.";
    }
  }

  async function loadAccess() {
    const { data, error } = await sb.rpc("get_my_access").maybeSingle();
    if (error) { console.error(error); access = null; } else access = data;
    paintAccess();
    clearInterval(accessTimer);
    accessTimer = setInterval(paintAccess, 30000);
  }

  /* ---------- Fotos en el chat ---------- */
  const chatForm = $("chat-form");
  const photoInput = document.createElement("input");
  photoInput.type = "file";
  photoInput.accept = "image/jpeg,image/png,image/webp";
  photoInput.className = "sr-only";
  const photoBtn = el("button", "c-ibtn");
  photoBtn.type = "button";
  photoBtn.setAttribute("aria-label", "Enviar una foto");
  photoBtn.innerHTML = ICON_CAM;
  const sendBtn = chatForm.querySelector('button[type="submit"]');
  if (sendBtn) {
    sendBtn.className = "c-ibtn gold";
    sendBtn.setAttribute("aria-label", "Enviar mensaje");
    sendBtn.innerHTML = ICON_SEND;
  }
  chatForm.prepend(photoBtn);
  chatForm.append(photoInput);

  // El campo del chat crece a medida que se escribe (hasta unas 5 líneas)
  const oldChatInput = $("chat-text");
  const chatTa = document.createElement("textarea");
  chatTa.id = "chat-text";
  chatTa.rows = 1;
  chatTa.maxLength = 2000;
  chatTa.autocomplete = "off";
  chatTa.placeholder = oldChatInput.placeholder;
  chatTa.setAttribute("aria-label", "Escribe un mensaje");
  oldChatInput.replaceWith(chatTa);
  const growChat = () => { chatTa.style.height = "auto"; chatTa.style.height = Math.min(chatTa.scrollHeight, 140) + "px"; };
  chatTa.addEventListener("input", growChat);
  chatTa.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && window.matchMedia("(pointer: fine)").matches) { ev.preventDefault(); chatForm.requestSubmit(); }
  });
  chatForm.addEventListener("submit", () => setTimeout(growChat, 0));

  const chatDock = el("div", "c-dockwrap");
  chatForm.remove();
  chatDock.append(chatForm);

  const photoError = (e) => {
    const m = String((e && e.message) || "");
    if (m.includes("limite_fotos")) return "Ya usaste tus 3 fotos de la prueba gratuita.";
    if (m.includes("fotos_requieren_suscripcion")) return "Las fotos requieren suscripción.";
    return "No se pudo enviar la foto.";
  };

  photoBtn.addEventListener("click", () => {
    if (access && !access.subscribed && access.photos_left <= 0) {
      say(access.in_trial ? "Ya no tienes fotos disponibles en la prueba gratuita." : "Las fotos requieren suscripción.");
      return;
    }
    photoInput.click();
  });

  photoInput.addEventListener("change", async () => {
    const f = photoInput.files[0];
    photoInput.value = "";
    if (!f || !current) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { say("Usa una imagen JPG, PNG o WEBP."); return; }
    if (f.size > 5 * 1024 * 1024) { say("La foto no puede superar los 5 MB."); return; }
    photoBtn.disabled = true;
    say("Enviando foto…");
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[f.type];
    const path = me.id + "/" + current.match_id + "/" + Date.now() + "." + ext;
    const up = await sb.storage.from("chat-photos").upload(path, f, { contentType: f.type, upsert: false });
    if (up.error) { console.error(up.error); say("No se pudo subir la foto."); photoBtn.disabled = false; return; }
    const { data, error } = await sb
      .from("messages")
      .insert({ match_id: current.match_id, sender_id: me.id, body: "", image_path: path })
      .select("id,sender_id,body,image_path,created_at")
      .single();
    if (error) {
      console.error(error);
      await sb.storage.from("chat-photos").remove([path]);
      say(photoError(error));
      photoBtn.disabled = false;
      loadAccess();
      return;
    }
    addMsg(data);
    say("Foto enviada.");
    photoBtn.disabled = false;
    loadAccess();
  });

  /* ---------- Planes y suscripción (modo de prueba) ---------- */
  async function loadPlans() {
    const box = views.plans;
    box.replaceChildren(el("p", "c-empty", "Cargando…"));
    await loadAccess();
    const { data: plans, error } = await sb.from("plans").select("id,name,days,price_cop").eq("active", true).order("days");
    if (error) {
      console.error(error);
      box.replaceChildren(el("p", "c-empty", "No se pudieron cargar los planes."));
      return;
    }
    const parts = [];
    const status = el("div", "c-mine");
    if (access && access.subscribed) {
      status.append(el("small", "c-muted", "Tu suscripción"), el("p", "", "Activa hasta el " + fmtDate(access.subscribed_until) + "."));
      if (access.is_tester) {
        const stop = el("button", "c-btn ghost", "Terminar suscripción de prueba");
        stop.type = "button";
        stop.addEventListener("click", async () => {
          const { error: err } = await sb.rpc("cancel_test_subscription");
          if (err) { console.error(err); say("No se pudo terminar la suscripción de prueba."); return; }
          say("Suscripción de prueba terminada.");
          loadPlans();
        });
        status.append(stop);
      }
    } else {
      status.append(el("small", "c-muted", "Tu cuenta"), el("p", "", access && access.in_trial ? "Prueba gratuita en curso." : "Tu prueba gratuita terminó."));
    }
    parts.push(status);

    parts.push(el("h3", "c-sub", "Qué incluye"));
    const ul = el("ul", "c-benefits");
    ["Fotos en el chat sin límite", "Llamadas y videollamadas (próximamente)"].forEach((t) => ul.append(el("li", "", t)));
    parts.push(ul);

    parts.push(el("h3", "c-sub", "Elige un plan"));
    (plans || []).forEach((p) => {
      const card = el("div", "c-plan");
      card.append(el("b", "", p.name), el("small", "c-muted", p.days + " días"));
      card.append(el("p", "", p.price_cop ? "$" + Number(p.price_cop).toLocaleString("es-CO") + " COP" : "Precio por definir"));
      const buy = el("button", "c-btn gold", "Suscribirme");
      buy.type = "button";
      buy.addEventListener("click", () => subscribe(p));
      card.append(buy);
      parts.push(card);
    });
    if (!(plans || []).length) parts.push(el("p", "c-empty", "Aún no hay planes disponibles."));
    box.replaceChildren(...parts);
  }

  async function subscribe(p) {
    if (!access || !access.is_tester) { say("El pago estará disponible pronto."); return; }
    if (!confirm("Modo de prueba: se activa sin cobrar. ¿Activar el plan " + p.name + "?")) return;
    const { error } = await sb.rpc("activate_test_subscription", { p_plan: p.id });
    if (error) { console.error(error); say("No se pudo activar la suscripción de prueba."); return; }
    say("Suscripción de prueba activada.");
    loadPlans();
  }

  /* ---------- Fotos del perfil, intención y arranque guiado ---------- */
  const publicUrl = (path) => sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

  function checkImage(f) {
    if (!f) return "Elige una foto.";
    if (!EXT[f.type]) return "Usa una imagen JPG, PNG o WEBP.";
    if (f.size > 5 * 1024 * 1024) return "La foto no puede superar los 5 MB.";
    return "";
  }

  // Mantiene la foto principal también en los datos del usuario (los lee el perfil clásico)
  async function syncMainPhoto(path) {
    try { await sb.auth.updateUser({ data: { avatar_path: path || "" } }); } catch (e) { console.error(e); }
    const img = $("profile-avatar");
    if (img) {
      if (path) { img.src = publicUrl(path); img.style.display = "block"; }
      else { img.removeAttribute("src"); img.style.display = "none"; }
    }
  }

  async function addPhoto(f) {
    const bad = checkImage(f);
    if (bad) return { error: bad };
    const path = me.id + "/photo-" + Date.now() + "." + EXT[f.type];
    const up = await sb.storage.from("avatars").upload(path, f, { contentType: f.type, upsert: false });
    if (up.error) { console.error(up.error); return { error: "No se pudo subir la foto." }; }
    const { error } = await sb.rpc("add_profile_photo", { p_path: path });
    if (error) {
      console.error(error);
      await sb.storage.from("avatars").remove([path]);
      return { error: String(error.message || "").includes("limite_fotos_perfil") ? "Ya tienes 6 fotos. Borra una para añadir otra." : "No se pudo guardar la foto." };
    }
    return { path };
  }

  async function listPhotos() {
    let { data, error } = await sb.from("profile_photos").select("id,path,position").order("position");
    if (error) { console.error(error); return null; }
    if (!data.length) {
      // migra la foto que ya tenía la persona a la nueva lista
      const { data: row } = await sb.from("profiles").select("avatar_path").eq("id", me.id).single();
      if (row && row.avatar_path) {
        await sb.rpc("add_profile_photo", { p_path: row.avatar_path });
        const again = await sb.from("profile_photos").select("id,path,position").order("position");
        data = again.data || [];
      }
    }
    return data;
  }

  const photosDialog = $("photos-dialog");
  async function renderPhotos() {
    const grid = $("photos-grid");
    const msg = $("photos-msg");
    grid.replaceChildren(el("p", "c-muted", "Cargando…"));
    const rows = await listPhotos();
    if (!rows) { grid.replaceChildren(el("p", "c-muted", "No se pudieron cargar tus fotos.")); return; }
    const nodes = rows.map((r, i) => {
      const tile = el("div", "c-ptile");
      const img = document.createElement("img");
      img.src = publicUrl(r.path);
      img.alt = "Foto " + (i + 1);
      tile.append(img);
      if (i === 0) tile.append(el("span", "c-ptag", "Principal"));
      const acts = el("div", "c-pt-acts");
      if (i !== 0) {
        const mk = el("button", "c-link", "Hacer principal");
        mk.type = "button";
        mk.onclick = async () => {
          const { data: path, error } = await sb.rpc("set_main_photo", { p_photo: r.id });
          if (error) { console.error(error); msg.textContent = "No se pudo cambiar la foto principal."; return; }
          await syncMainPhoto(path);
          renderPhotos();
        };
        acts.append(mk);
      }
      const del = el("button", "c-link", "Borrar");
      del.type = "button";
      del.onclick = async () => {
        if (!confirm("¿Borrar esta foto?")) return;
        const { data: path, error } = await sb.rpc("delete_profile_photo", { p_photo: r.id });
        if (error) { console.error(error); msg.textContent = "No se pudo borrar la foto."; return; }
        if (path) { try { await sb.storage.from("avatars").remove([path]); } catch (e) { console.error(e); } }
        const left = await listPhotos();
        await syncMainPhoto(left && left[0] ? left[0].path : "");
        renderPhotos();
      };
      acts.append(del);
      tile.append(acts);
      return tile;
    });
    if (rows.length < 6) {
      const add = el("label", "c-ptile c-padd");
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp";
      input.className = "sr-only";
      add.append(document.createTextNode("+ Añadir foto"), input);
      input.addEventListener("change", async () => {
        const f = input.files[0];
        input.value = "";
        if (!f) return;
        msg.textContent = "Subiendo…";
        const r = await addPhoto(f);
        if (r.error) { msg.textContent = r.error; return; }
        msg.textContent = "";
        if (!rows.length) await syncMainPhoto(r.path);
        renderPhotos();
      });
      nodes.push(add);
    }
    grid.replaceChildren(...nodes);
  }
  const managePhotos = $("manage-photos");
  if (managePhotos && photosDialog) {
    managePhotos.addEventListener("click", () => {
      if (!me) return;
      $("photos-msg").textContent = "";
      photosDialog.showModal();
      renderPhotos();
    });
    $("close-photos").addEventListener("click", () => photosDialog.close());
  }

  // "¿Qué buscas?" dentro de Mi perfil
  const intentSel = $("profile-intent");
  if (intentSel) {
    $("profile").addEventListener("click", async () => {
      const { data } = await sb.auth.getUser();
      intentSel.value = (data.user && data.user.user_metadata && data.user.user_metadata.intent) || "";
    });
    intentSel.addEventListener("change", async () => {
      if (!intentSel.value) return;
      const { error } = await sb.auth.updateUser({ data: { intent: intentSel.value } });
      if (error) { console.error(error); alert("No se pudo guardar lo que buscas."); }
    });
  }

  // Arranque guiado: solo pide lo que falta
  async function maybeOnboard() {
    try { if (Number(localStorage.getItem("em_onb_skip") || 0) > Date.now()) return; } catch (e) { /* sin almacenamiento */ }
    const { data: p } = await sb.from("profiles").select("full_name,country,description,avatar_path,intent").eq("id", me.id).single();
    if (!p) return;
    if (p.avatar_path && p.country && (p.description || "").trim() && p.intent) return;
    startOnboarding(p);
  }

  function startOnboarding(p) {
    const st = { country: p.country || "", description: p.description || "", intent: p.intent || "", photoPath: "" };
    const steps = [];
    if (!p.avatar_path) steps.push("photo");
    if (!p.country || !(p.description || "").trim()) steps.push("about");
    if (!p.intent) steps.push("intent");
    if (!steps.length) return;
    let n = 0;

    const over = el("div", "c-onboard");
    over.setAttribute("role", "dialog");
    over.setAttribute("aria-modal", "true");
    over.setAttribute("aria-label", "Completa tu perfil");
    const card = el("div", "c-ob-card");
    const dots = el("div", "c-ob-dots");
    const body = el("div");
    const msg = el("p", "c-ob-msg");
    msg.setAttribute("role", "status");
    const nav = el("div", "c-ob-nav");
    const back = el("button", "c-btn ghost", "Atrás");
    back.type = "button";
    const next = el("button", "c-btn gold", "Siguiente");
    next.type = "button";
    nav.append(back, next);
    const later = el("button", "c-link", "Ahora no");
    later.type = "button";
    card.append(dots, body, msg, nav, later);
    over.append(card);
    document.body.append(over);

    later.onclick = () => {
      try { localStorage.setItem("em_onb_skip", String(Date.now() + 24 * 3600 * 1000)); } catch (e) { /* nada */ }
      over.remove();
    };

    let aboutSel, aboutTa;
    function render() {
      const key = steps[n];
      msg.textContent = "";
      dots.replaceChildren(...steps.map((_, i) => el("i", i <= n ? "on" : "")));
      back.hidden = n === 0;
      next.textContent = n === steps.length - 1 ? "Listo" : "Siguiente";
      next.disabled = false;
      body.replaceChildren();
      if (key === "photo") {
        body.append(el("h2", "", "Tu foto principal"), el("p", "c-muted", "Las personas con foto reciben muchos más «me gusta». Después podrás añadir hasta 6."));
        const prev = document.createElement("img");
        prev.className = "c-ob-photo";
        prev.alt = "Tu foto principal";
        if (st.photoPath) prev.src = publicUrl(st.photoPath); else prev.hidden = true;
        const pick = el("label", "c-btn ghost c-pick");
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/jpeg,image/png,image/webp";
        input.className = "sr-only";
        pick.append(document.createTextNode(st.photoPath ? "Cambiar foto" : "Elegir foto"), input);
        input.addEventListener("change", async () => {
          const f = input.files[0];
          input.value = "";
          if (!f) return;
          msg.textContent = "Subiendo…";
          next.disabled = true;
          const r = await addPhoto(f);
          next.disabled = false;
          if (r.error) { msg.textContent = r.error; return; }
          st.photoPath = r.path;
          await syncMainPhoto(r.path);
          render();
        });
        body.append(prev, pick);
        next.disabled = !st.photoPath;
      } else if (key === "about") {
        body.append(el("h2", "", "Cuéntanos de ti"));
        aboutSel = document.createElement("select");
        aboutSel.setAttribute("aria-label", "País de residencia");
        aboutSel.innerHTML = $("profile-country").innerHTML;
        aboutSel.value = st.country;
        aboutTa = document.createElement("textarea");
        aboutTa.rows = 4;
        aboutTa.maxLength = 500;
        aboutTa.placeholder = "Un poco sobre ti y lo que buscas";
        aboutTa.setAttribute("aria-label", "Sobre mí");
        aboutTa.value = st.description;
        body.append(aboutSel, aboutTa);
      } else {
        body.append(el("h2", "", "¿Qué buscas?"), el("p", "c-muted", "Así encontraremos personas con tus mismas metas."));
        const opts = el("div", "c-ob-options");
        opts.setAttribute("role", "group");
        Object.entries(INTENTS).forEach(([k, label]) => {
          const b = el("button", "c-ob-opt", label);
          b.type = "button";
          b.setAttribute("aria-pressed", st.intent === k ? "true" : "false");
          b.onclick = () => { st.intent = k; render(); };
          opts.append(b);
        });
        body.append(opts);
        next.disabled = !st.intent;
      }
    }

    back.onclick = () => { collect(); n = Math.max(0, n - 1); render(); };
    function collect() {
      if (steps[n] === "about" && aboutSel) { st.country = aboutSel.value; st.description = aboutTa.value; }
    }
    next.onclick = async () => {
      collect();
      const key = steps[n];
      if (key === "about" && (!st.country || st.description.trim().length < 10)) {
        msg.textContent = "Elige tu país y escribe al menos 10 caracteres sobre ti.";
        return;
      }
      if (n < steps.length - 1) { n += 1; render(); return; }
      next.disabled = true;
      msg.textContent = "Guardando…";
      const patch = {};
      if (st.country) patch.country = st.country;
      if (st.description.trim()) patch.description = st.description.trim();
      if (st.intent) patch.intent = st.intent;
      const { error } = await sb.from("profiles").update(patch).eq("id", me.id);
      if (error) {
        console.error(error);
        msg.textContent = isBlocked(error) ? "Tu descripción no puede incluir teléfonos, redes sociales, correos o enlaces, ni pedir dinero." : "No se pudo guardar. Inténtalo de nuevo.";
        next.disabled = false;
        if (isBlocked(error)) { n = steps.indexOf("about"); if (n >= 0) render(); }
        return;
      }
      await sb.auth.updateUser({ data: { country: st.country, description: st.description.trim(), intent: st.intent } });
      over.remove();
      say("Listo: tu perfil está completo.");
      if (view === "discover") loadDiscover();
    };
    render();
  }

  /* ---------- Avisos de mensajes y coincidencias ---------- */
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch((e) => console.error("sw", e));

  const matchCache = new Map();
  const unread = new Set();
  let notifChannel = null;
  let notifFor = null;
  const isUnread = (m) => (m.last_at
    ? m.last_sender !== me.id && new Date(m.last_at).getTime() > getSeen(m.match_id)
    : getSeen(m.match_id) === 0);

  function paintUnread() {
    const btn = community.querySelector('.c-tabs button[data-tab="matches"]');
    if (btn) {
      const old = btn.querySelector(".c-tab-badge");
      if (old) old.remove();
      if (unread.size) btn.append(el("span", "c-tab-badge", unread.size > 9 ? "9+" : String(unread.size)));
    }
    try {
      if (navigator.setAppBadge) {
        const p = unread.size ? navigator.setAppBadge(unread.size) : navigator.clearAppBadge();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { /* sin soporte */ }
  }

  async function refreshMatchCache() {
    if (!me) return;
    const { data } = await sb.rpc("get_my_matches").select("*");
    matchCache.clear();
    unread.clear();
    (data || []).forEach((m) => { matchCache.set(m.match_id, m); if (isUnread(m)) unread.add(m.match_id); });
    paintUnread();
  }

  async function notify(title, body, tag) {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, { body, icon: "icon-192.png", badge: "icon-192.png", tag, data: { url: "./" } });
    } catch (e) { console.error(e); }
  }

  async function onNewMessage(payload) {
    const m = payload.new;
    if (!me || m.sender_id === me.id) return;
    if (!community.hidden && current && current.match_id === m.match_id) { markSeen(m.match_id); return; }
    let info = matchCache.get(m.match_id);
    if (!info) { await refreshMatchCache(); info = matchCache.get(m.match_id); }
    unread.add(m.match_id);
    paintUnread();
    const name = (info && info.full_name) || "alguien";
    if (!community.hidden) say("Nuevo mensaje de " + name);
    notify("Nuevo mensaje", name + " te escribió.", "msg-" + m.match_id);
    if (!community.hidden && view === "matches") loadMatches();
  }

  async function onNewMatch(payload) {
    const r = payload.new;
    if (!me || (r.user_a !== me.id && r.user_b !== me.id)) return;
    await refreshMatchCache();
    const m = matchCache.get(r.id);
    const name = (m && m.full_name) || "alguien";
    if (!community.hidden) say("¡Nueva coincidencia con " + name + "!");
    notify("¡Nueva coincidencia!", "Tú y " + name + " se dieron «Me gusta».", "match-" + r.id);
    if (!community.hidden && view === "matches") loadMatches();
  }

  function startNotifications() {
    if (!me) { stopNotifications(); return; }
    if (notifFor === me.id) return;
    stopNotifications();
    notifFor = me.id;
    notifChannel = sb.channel("notif-" + me.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, onNewMessage)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "matches" }, onNewMatch)
      .subscribe();
    refreshMatchCache();
  }

  function stopNotifications() {
    if (notifChannel) { sb.removeChannel(notifChannel); notifChannel = null; }
    notifFor = null;
    unread.clear();
    matchCache.clear();
    paintUnread();
  }

  function notifyCard() {
    if (!("Notification" in window) || Notification.permission !== "default") return null;
    const card = el("div", "c-banner");
    card.append(el("p", "", "Activa los avisos para enterarte de mensajes y coincidencias nuevas."));
    const b = el("button", "c-btn gold", "Activar avisos");
    b.type = "button";
    b.onclick = async () => {
      const r = await Notification.requestPermission();
      say(r === "granted" ? "Avisos activados." : "No se activaron los avisos.");
      card.remove();
    };
    card.append(b);
    return card;
  }

  /* ---------- "Sobre mí" que muestra todo el texto ---------- */
  const descTa = $("profile-description");
  const profileDlg = $("profile-dialog");
  if (descTa && profileDlg) {
    const fitDesc = () => { descTa.style.height = "auto"; descTa.style.height = descTa.scrollHeight + 2 + "px"; };
    descTa.addEventListener("input", fitDesc);
    new MutationObserver(() => { if (profileDlg.open) requestAnimationFrame(fitDesc); })
      .observe(profileDlg, { attributes: true, attributeFilter: ["open"] });
  }

  /* ---------- Eliminar cuenta ---------- */
  const delBtn = $("delete-account");
  if (delBtn) {
    delBtn.addEventListener("click", async () => {
      const msg = $("delete-message");
      const typed = (prompt("Esto borra tu cuenta, tu perfil, tus fotos, estados y mensajes. No se puede deshacer.\n\nPara confirmar escribe ELIMINAR:") || "").trim();
      if (typed !== "ELIMINAR") return;
      delBtn.disabled = true;
      msg.textContent = "Eliminando tu cuenta…";

      const { data: u } = await sb.auth.getUser();
      const user = u.user;
      if (!user) { msg.textContent = "Inicia sesión de nuevo."; delBtn.disabled = false; return; }

      // 1. Reunir las rutas de sus fotos antes de borrar nada
      const paths = new Set();
      try {
        const { data: files } = await sb.storage.from("avatars").list(user.id, { limit: 1000 });
        (files || []).forEach((f) => paths.add(user.id + "/" + f.name));
        if (user.user_metadata?.avatar_path) paths.add(user.user_metadata.avatar_path);
        const { data: sts } = await sb.from("statuses").select("image_path");
        (sts || []).forEach((s) => s.image_path && paths.add(s.image_path));
      } catch (e) { console.error(e); }

      const chatPaths = [];
      try {
        const { data: ms } = await sb.from("messages").select("image_path").eq("sender_id", user.id).not("image_path", "is", null);
        (ms || []).forEach((m) => chatPaths.push(m.image_path));
      } catch (e) { console.error(e); }

      // 2. Borrar la cuenta (y en cascada perfil, estados, likes, coincidencias y mensajes)
      const { error } = await sb.rpc("delete_my_account");
      if (error) {
        console.error(error);
        msg.textContent = "No se pudo eliminar la cuenta. Escríbenos para ayudarte.";
        delBtn.disabled = false;
        return;
      }

      // 3. Borrar las fotos (mejor esfuerzo) y cerrar la sesión
      try { if (paths.size) await sb.storage.from("avatars").remove([...paths]); } catch (e) { console.error(e); }
      try { if (chatPaths.length) await sb.storage.from("chat-photos").remove(chatPaths); } catch (e) { console.error(e); }
      await sb.auth.signOut({ scope: "local" });
      $("profile-dialog")?.close();
      closeCommunity();
      alert("Tu cuenta fue eliminada.");
    });
  }

  /* Portada: no prometer verificación de identidad hasta que exista */
  try {
    const t = { es: "Reportes y bloqueos", en: "Reports and blocking", fr: "Signalement et blocage", pt: "Denúncias e bloqueio", de: "Melden und Blockieren", "zh-Hans": "举报与屏蔽", "zh-Hant": "檢舉與封鎖" };
    Object.keys(t).forEach((k) => { if (translations[k]) translations[k].verified = t[k]; });
    applyLanguage(document.getElementById("language").value);
  } catch (e) { console.error(e); }
})();
