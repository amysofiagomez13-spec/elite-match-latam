const translations = {
  es: { eyebrow:"UNA COMUNIDAD INTERNACIONAL", headline:"Conexiones auténticas.<br><em>Relaciones con propósito.</em>", intro:"Conoce personas latinas y de todo el mundo, mayores de 28 años, que también buscan una relación seria.", verified:"Identidad verificada", age:"Solo mayores de 28 años", purpose:"Relaciones con propósito", signup:"Crear cuenta", login:"Iniciar sesión", notice:"La verificación y las funciones de seguridad se incorporarán en las siguientes etapas. Esta versión es una página inicial de demostración.", tagline:"Latinoamérica y el mundo, en un solo lugar.", soon:"Próximamente", soonText:"Estamos preparando esta función." },
  en: { eyebrow:"AN INTERNATIONAL COMMUNITY", headline:"Authentic connections.<br><em>Relationships with purpose.</em>", intro:"Meet people from Latin America and around the world, aged 28 and over, who are also looking for a serious relationship.", verified:"Verified identity", age:"Ages 28 and over", purpose:"Relationships with purpose", signup:"Create account", login:"Log in", notice:"Identity verification and security features will be added in later stages. This is an initial demo page.", tagline:"Latin America and the world, in one place.", soon:"Coming soon", soonText:"We are preparing this feature." },
  fr: { eyebrow:"UNE COMMUNAUTÉ INTERNATIONALE", headline:"Des liens authentiques.<br><em>Des relations qui ont du sens.</em>", intro:"Rencontrez des personnes d’Amérique latine et du monde entier, âgées de 28 ans et plus, qui recherchent aussi une relation sérieuse.", verified:"Identité vérifiée", age:"28 ans et plus", purpose:"Des relations qui ont du sens", signup:"Créer un compte", login:"Se connecter", notice:"La vérification d’identité et les fonctions de sécurité seront ajoutées dans les prochaines étapes. Ceci est une page de démonstration.", tagline:"L’Amérique latine et le monde, au même endroit.", soon:"Bientôt disponible", soonText:"Nous préparons cette fonctionnalité." },
  pt: { eyebrow:"UMA COMUNIDADE INTERNACIONAL", headline:"Conexões autênticas.<br><em>Relacionamentos com propósito.</em>", intro:"Conheça pessoas da América Latina e do mundo, com 28 anos ou mais, que também procuram um relacionamento sério.", verified:"Identidade verificada", age:"A partir de 28 anos", purpose:"Relacionamentos com propósito", signup:"Criar conta", login:"Entrar", notice:"A verificação de identidade e os recursos de segurança serão adicionados nas próximas etapas. Esta é uma página inicial de demonstração.", tagline:"América Latina e o mundo, em um só lugar.", soon:"Em breve", soonText:"Estamos preparando este recurso." },
  de: { eyebrow:"EINE INTERNATIONALE GEMEINSCHAFT", headline:"Echte Verbindungen.<br><em>Beziehungen mit Bedeutung.</em>", intro:"Lerne Menschen aus Lateinamerika und der ganzen Welt ab 28 Jahren kennen, die ebenfalls eine ernsthafte Beziehung suchen.", verified:"Identität verifiziert", age:"Ab 28 Jahren", purpose:"Beziehungen mit Bedeutung", signup:"Konto erstellen", login:"Anmelden", notice:"Identitätsprüfung und Sicherheitsfunktionen werden in späteren Schritten ergänzt. Dies ist eine erste Demoseite.", tagline:"Lateinamerika und die Welt an einem Ort.", soon:"Demnächst", soonText:"Wir bereiten diese Funktion vor." },
  "zh-Hans": { eyebrow:"国际社群", headline:"真诚连接。<br><em>让关系更有意义。</em>", intro:"认识来自拉丁美洲和世界各地、年满28岁，并同样寻求认真关系的人。", verified:"身份验证", age:"仅限28岁及以上", purpose:"有意义的关系", signup:"创建账户", login:"登录", notice:"身份验证和安全功能将在后续阶段加入。这是初始演示页面。", tagline:"拉丁美洲与世界，尽在一处。", soon:"即将推出", soonText:"我们正在准备此功能。" },
  "zh-Hant": { eyebrow:"國際社群", headline:"真誠連結。<br><em>讓關係更有意義。</em>", intro:"認識來自拉丁美洲和世界各地、年滿28歲，並同樣尋求認真關係的人。", verified:"身分驗證", age:"僅限28歲及以上", purpose:"有意義的關係", signup:"建立帳戶", login:"登入", notice:"身分驗證和安全功能將在後續階段加入。這是初始示範頁面。", tagline:"拉丁美洲與世界，盡在一處。", soon:"即將推出", soonText:"我們正在準備此功能。" }
};
const language = document.getElementById("language");
const dialog = document.getElementById("message-dialog");
function applyLanguage(code) {
  const t = translations[code] || translations.es;
  document.documentElement.lang = code;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    if (t[key]) el.innerHTML = t[key];
  });
  document.getElementById("dialog-title").textContent = t.soon;
  document.getElementById("dialog-text").textContent = t.soonText;
  document.getElementById("language-label").textContent = code === "es" ? "Selecciona tu idioma" : "Select your language";
}
language.addEventListener("change", e => applyLanguage(e.target.value));


const signupButton = document.getElementById("signup");
const signupDialog = document.getElementById("signup-dialog");

signupButton.addEventListener("click", () => {
  signupDialog.showModal();
});

document.getElementById("close-signup").addEventListener("click", () => {
  signupDialog.close();
});



document.getElementById("login").addEventListener("click", () => {
  dialog.showModal();
  document.getElementById("dialog-title").textContent = "Iniciar sesión";
  document.getElementById("dialog-text").textContent =
    "Pronto conectaremos el formulario de acceso seguro.";
});

document.getElementById("close-dialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });
document.getElementById("year").textContent = new Date().getFullYear();
applyLanguage("es");
console.log("La página llegó hasta la conexión de Supabase");
const supabaseClient = window.supabase.createClient(
  "https://hcfwmqdhxmkrgfvffwor.supabase.co",
  "sb_publishable_Ec8DhxkXMr3PxDU32uMgfg_33389Fm-"
);


const signupForm = document.getElementById("signup-form");
const signupMessage = document.getElementById("signup-message");

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const birthdate = document.getElementById("signup-birthdate").value;
  const password = document.getElementById("signup-password").value;
  const terms = document.getElementById("signup-terms").checked;

  if (!birthdate) {
    signupMessage.textContent = "Ingresa tu fecha de nacimiento.";
    return;
  }

  const today = new Date();
  const birth = new Date(birthdate + "T00:00:00");
  let age = today.getFullYear() - birth.getFullYear();

  if (
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() &&
     today.getDate() < birth.getDate())
  ) {
    age--;
  }

  if (birth > today || age < 28) {
    signupMessage.textContent =
      "Debes tener 28 años o más para unirte a Elite Match LatAm.";
    return;
  }

  if (password.length < 8) {
    signupMessage.textContent =
      "La contraseña debe tener al menos 8 caracteres.";
    return;
  }

  if (!terms) {
    signupMessage.textContent =
      "Debes aceptar las condiciones de uso y privacidad.";
    return;
  }

  signupMessage.textContent = "Creando tu cuenta...";

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: name,
        birthdate: birthdate
      }
    }
  });

  if (error) {
    signupMessage.textContent =
      "No se pudo crear la cuenta: " + error.message;
    return;
  }

  if (data.user && data.user.identities &&
      data.user.identities.length === 0) {
    signupMessage.textContent =
      "No se pudo completar el registro. Comprueba el correo o intenta iniciar sesión.";
    return;
  }

  signupForm.reset();
  signupMessage.textContent =
    "¡Registro iniciado! Revisa tu correo electrónico y confirma tu cuenta para poder iniciar sesión.";
});
  
