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

  function say(msg) {
    toastBox.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastBox.textContent = ""), 3500);
  }

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
      if (error) console.error("No se pudo sincronizar el perfil:", error);
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
  const views = { discover: $("v-discover"), matches: $("v-matches"), chat: $("v-chat") };
  const titles = { discover: "Descubrir", matches: "Coincidencias" };

  function leaveChat() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    current = null;
    $("c-menu").hidden = true;
    $("c-more").hidden = true;
  }

  function showView(name) {
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
  }

  function closeCommunity() {
    leaveChat();
    community.hidden = true;
    document.body.style.overflow = "";
  }

  enter.addEventListener("click", async () => {
    await syncProfile();
    community.hidden = false;
    document.body.style.overflow = "hidden";
    showTab("discover");
  });

  $("c-home").addEventListener("click", () => (current ? showTab("matches") : closeCommunity()));
  community.querySelectorAll(".c-tabs button[data-tab]").forEach((b) =>
    b.addEventListener("click", () => showTab(b.dataset.tab))
  );
  $("c-profile").addEventListener("click", () => { closeCommunity(); $("profile").click(); });

  /* ---------- Descubrir ---------- */
  async function loadDiscover() {
    const box = views.discover;
    box.replaceChildren(el("p", "c-empty", "Buscando perfiles…"));
    const { data, error } = await sb.from("discover_profiles").select("*").limit(30);
    if (error) {
      console.error(error);
      box.replaceChildren(el("p", "c-empty", "No se pudieron cargar los perfiles. Inténtalo de nuevo."));
      return;
    }
    deck = data || [];
    renderCard();
  }

  function renderCard() {
    const box = views.discover;
    const p = deck[0];
    if (!p) {
      box.replaceChildren(el("p", "c-empty", "Por ahora no hay más perfiles. Vuelve pronto."));
      return;
    }
    const card = el("article", "c-card");
    card.append(avatar(p.avatar_path, p.full_name, "big"));
    if (p.is_verified) card.append(el("span", "c-badge", "Identidad verificada"));
    card.append(el("h2", "", (p.full_name || "Sin nombre") + ", " + p.age));
    if (p.country) card.append(el("p", "c-muted", p.country));
    if (p.description) card.append(el("p", "c-bio", p.description));

    const acts = el("div", "c-acts");
    const pass = el("button", "c-btn ghost", "Pasar");
    pass.type = "button";
    pass.onclick = () => { deck.shift(); renderCard(); };
    const like = el("button", "c-btn gold", "Me gusta");
    like.type = "button";
    like.onclick = () => doLike(p, like);
    acts.append(pass, like);
    box.replaceChildren(card, acts);
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
    const { data } = await sb.from("my_matches").select("match_id").eq("other_id", p.id).maybeSingle();
    say(data ? "¡Es una coincidencia! Ya pueden escribirse." : "Me gusta enviado.");
    deck.shift();
    renderCard();
  }

  /* ---------- Coincidencias ---------- */
  async function loadMatches() {
    const box = views.matches;
    box.replaceChildren(el("p", "c-empty", "Cargando…"));
    const { data, error } = await sb.from("my_matches").select("*").order("created_at", { ascending: false });
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
    box.append(el("div", "c-msg " + (m.sender_id === me.id ? "s" : "r"), m.body));
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
      .select("id,sender_id,body,created_at")
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
      .select("id,sender_id,body,created_at")
      .single();
    if (error) {
      console.error(error);
      input.value = body;
      say("No se pudo enviar el mensaje.");
      return;
    }
    addMsg(data);
  });

  /* ---------- Bloquear y reportar ---------- */
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
})();
