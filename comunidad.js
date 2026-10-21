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

  const views = { discover: $("v-discover"), matches: $("v-matches"), chat: $("v-chat"), status: vStatus, plans: vPlans };
  const titles = { discover: "Descubrir", matches: "Coincidencias", status: "Estados", plans: "Planes" };

  function leaveChat() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    current = null;
    $("c-menu").hidden = true;
    $("c-more").hidden = true;
  }

  function showView(name) {
    view = name;
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
    community.hidden = false;
    document.body.style.overflow = "hidden";
    showTab("discover");
  });

  $("c-home").addEventListener("click", () => {
    if (current) showTab("matches");
    else if (view === "plans") showTab("discover");
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
    const { data, error } = await sb.rpc("get_discover_profiles").limit(30);
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
    renderCard();
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

  function renderCard() {
    const box = views.discover;
    const p = deck[0];
    if (!p) {
      const empty = el("div", "c-empty");
      empty.append(el("p", "", "Por ahora no hay más perfiles."), el("p", "c-muted", "Vuelve en un rato o invita a alguien que conozcas."));
      const again = el("button", "c-btn gold", "Actualizar");
      again.type = "button";
      again.onclick = loadDiscover;
      empty.append(again);
      box.replaceChildren(...(banner ? [banner] : []), empty);
      return;
    }
    const card = el("article", "c-card");
    card.append(avatar(p.avatar_path, p.full_name, "big"));
    if (p.is_verified) card.append(el("span", "c-badge", "Identidad verificada"));
    card.append(el("h2", "", (p.full_name || "Sin nombre") + ", " + p.age));
    if (p.country) card.append(el("p", "c-muted", p.country));
    if (p.description) card.append(el("p", "c-bio", p.description));
    if (p.status || p.statusImage) {
      const st = el("div", "c-status");
      st.append(el("small", "c-muted", "Su estado de hoy"));
      if (p.statusImage) st.append(statusImg(p.statusImage));
      if (p.status) st.append(el("p", "", p.status));
      card.append(st);
    }

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
    box.replaceChildren(...(banner ? [banner] : []), card, acts, rep);
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
    const { data, error } = await sb.rpc("get_active_statuses").select("*").order("created_at", { ascending: false }).limit(50);
    if (error) {
      console.error(error);
      box.replaceChildren(el("p", "c-empty", "No se pudieron cargar los estados."));
      return;
    }
    const mine = data.find((s) => s.user_id === me.id);
    const others = data.filter((s) => s.user_id !== me.id);

    // Publicar
    const compose = el("form", "c-compose");
    const ta = document.createElement("textarea");
    ta.maxLength = 140;
    ta.rows = 3;
    ta.placeholder = "¿Qué quieres contar hoy?";
    ta.setAttribute("aria-label", "Tu estado");
    const count = el("small", "c-muted", "0/140");
    ta.addEventListener("input", () => (count.textContent = ta.value.length + "/140"));
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/jpeg,image/png,image/webp";
    file.className = "sr-only";
    const pick = el("label", "c-btn ghost c-pick");
    const pickText = document.createTextNode("Añadir foto");
    pick.append(file, pickText);
    const prev = document.createElement("img");
    prev.className = "c-st-img";
    prev.alt = "Vista previa de la foto";
    prev.hidden = true;
    const clear = el("button", "c-link", "Quitar foto");
    clear.type = "button";
    clear.hidden = true;
    file.addEventListener("change", () => {
      const f = file.files[0];
      if (prev.src.startsWith("blob:")) URL.revokeObjectURL(prev.src);
      if (f) {
        prev.src = URL.createObjectURL(f);
        prev.hidden = false;
        clear.hidden = false;
        pickText.nodeValue = "Cambiar foto";
      } else {
        prev.removeAttribute("src");
        prev.hidden = true;
        clear.hidden = true;
        pickText.nodeValue = "Añadir foto";
      }
    });
    clear.addEventListener("click", () => { file.value = ""; file.dispatchEvent(new Event("change")); });
    const pub = el("button", "c-btn gold", mine ? "Reemplazar mi estado" : "Publicar estado");
    pub.type = "submit";
    compose.append(ta, count, pick, prev, clear, el("small", "c-muted", "Foto opcional: JPG, PNG o WEBP, máximo 5 MB"), pub);
    compose.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      const f = file.files[0];
      if (!body && !f) { say("Escribe algo o elige una foto."); return; }
      if (f && !["image/jpeg", "image/png", "image/webp"].includes(f.type)) { say("Usa una imagen JPG, PNG o WEBP."); return; }
      if (f && f.size > 5 * 1024 * 1024) { say("La foto no puede superar los 5 MB."); return; }
      pub.disabled = true;
      let image_path = null;
      if (f) {
        const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[f.type];
        image_path = me.id + "/status-" + Date.now() + "." + ext;
        const { error: upErr } = await sb.storage.from("avatars").upload(image_path, f, { contentType: f.type, upsert: false });
        if (upErr) { console.error(upErr); say("No se pudo subir la foto."); pub.disabled = false; return; }
      }
      const { data: created, error: err } = await sb.from("statuses").insert({ body, image_path }).select("id").single();
      if (err) {
        console.error(err);
        if (image_path) await sb.storage.from("avatars").remove([image_path]);
        say(isBlocked(err) ? BLOCK_MSG : "No se pudo publicar tu estado.");
        pub.disabled = false;
        return;
      }
      if (mine && mine.image_path) await sb.storage.from("avatars").remove([mine.image_path]);
      await sb.from("statuses").delete().eq("user_id", me.id).neq("id", created.id); // un solo estado activo
      say("Estado publicado por 24 horas.");
      loadStatuses();
    });

    const parts = [compose];

    // Tu estado actual
    if (mine) {
      const card = el("div", "c-mine");
      card.append(el("small", "c-muted", "Tu estado · " + timeAgo(mine.created_at) + " · " + expiresIn(mine.created_at)));
      if (mine.image_path) card.append(statusImg(mine.image_path));
      if (mine.body) card.append(el("p", "", mine.body));
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
        row.append(t);
        list.append(row);
      });
      parts.push(list);
    }
    box.replaceChildren(...parts);
  }

  /* ---------- Coincidencias ---------- */
  async function loadMatches() {
    const box = views.matches;
    box.replaceChildren(el("p", "c-empty", "Cargando…"));
    const { data, error } = await sb.rpc("get_my_matches").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      box.replaceChildren(el("p", "c-empty", "No se pudieron cargar tus coincidencias."));
      return;
    }
    if (!data.length) {
      box.replaceChildren(el("p", "c-empty", "Aún no tienes coincidencias. Da “Me gusta” en Descubrir."));
      return;
    }
    const list = el("div", "c-list");
    data.forEach((m) => {
      const row = el("button", "c-row");
      row.type = "button";
      row.append(avatar(m.avatar_path, m.full_name));
      const txt = el("div");
      txt.append(el("b", "", m.full_name || "Sin nombre"), el("small", "", "Toca para escribir"));
      row.append(txt);
      row.onclick = () => openChat(m);
      list.append(row);
    });
    box.replaceChildren(list);
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
  async function reportUser(userId, statusRow) {
    const reason = (prompt("Cuéntanos qué pasó (mínimo 3 caracteres):") || "").trim();
    if (reason.length < 3) return;
    const row = { reporter: me.id, reported: userId, reason };
    if (statusRow) {
      row.status_id = statusRow.id;
      row.status_snapshot = ((statusRow.body || "") + (statusRow.image_path ? " | foto: " + statusRow.image_path : "")).slice(0, 1500);
    }
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
      accessText.textContent = "Prueba gratis: te quedan " + Math.floor(left / 3600) + " h " + Math.floor((left % 3600) / 60) + " min · Fotos: " + access.photos_left + " de 3.";
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
  const photoBtn = el("button", "c-photo", "Foto");
  photoBtn.type = "button";
  photoBtn.setAttribute("aria-label", "Enviar una foto");
  chatForm.prepend(photoBtn);
  chatForm.append(photoInput);

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
