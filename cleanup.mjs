// Limpieza programada: borra estados (24 h) y publicaciones del muro (48 h) vencidos,
// incluidas sus fotos. Se ejecuta en GitHub Actions con claves guardadas como secretos.
const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) { console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const H = KEY.startsWith("sb_")
  ? { apikey: KEY, "Content-Type": "application/json" }
  : { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

async function rest(path, opts = {}) {
  const r = await fetch(BASE + "/rest/v1/" + path, { headers: H, ...opts });
  if (!r.ok) throw new Error(path + " -> " + r.status + " " + (await r.text()));
  return r.status === 204 ? null : r.json();
}

async function removeFiles(paths) {
  const r = await fetch(BASE + "/storage/v1/object/avatars", {
    method: "DELETE", headers: H, body: JSON.stringify({ prefixes: paths }),
  });
  if (!r.ok) throw new Error("storage -> " + r.status + " " + (await r.text()));
}

async function purge(table, column, cutoffISO) {
  let total = 0, photos = 0;
  for (let i = 0; i < 20; i++) {
    const rows = await rest(`${table}?select=id,image_path&${column}=lt.${encodeURIComponent(cutoffISO)}&limit=100`);
    if (!rows.length) break;
    const paths = rows.map((r) => r.image_path).filter(Boolean);
    if (paths.length) await removeFiles(paths);
    await rest(`${table}?id=in.(${rows.map((r) => r.id).join(",")})`, {
      method: "DELETE", headers: { ...H, Prefer: "return=minimal" },
    });
    total += rows.length; photos += paths.length;
  }
  console.log(`${table}: ${total} borrados, ${photos} fotos`);
}

const now = Date.now();
await purge("posts", "created_at", new Date(now - 48 * 3600 * 1000).toISOString());
await purge("statuses", "expires_at", new Date(now).toISOString());
