// backend/api/utils/db.js
import pkg from "pg";
const { Pool } = pkg;

// Toma primero la URL "pooled" si existe (Neon), si no, la normal.
const CONNECTION_STRING =
  process.env.DATABASE_URL_POOLED ||
  process.env.DATABASE_URL ||
  process.env.PGURL ||
  process.env.POSTGRES_URL ||
  "";

// Decide si usar SSL
function parseBool(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return null;
}

const envSSL =
  parseBool(process.env.PGSSL) ??
  parseBool(process.env.DATABASE_SSL);

// Heurística por URL/host si no se definió por env
const shouldUseSSL = (() => {
  if (envSSL !== null) return envSSL;
  if (/\bsslmode=require\b/i.test(CONNECTION_STRING)) return true;
  if (/(neon\.tech|render\.com|supabase\.co|herokuapp\.com)/i.test(CONNECTION_STRING)) return true;
  // En producción solemos querer SSL; en local no.
  return String(process.env.NODE_ENV).toLowerCase() === "production";
})();

const pool = new Pool({
  connectionString: CONNECTION_STRING || undefined,
  ssl: shouldUseSSL ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT || 10000),
  keepAlive: true,
});

// (Opcional) log útil para depurar
console.log(
  `[DB] using ${CONNECTION_STRING ? "DATABASE_URL" : "local config"} | SSL: ${
    shouldUseSSL ? "on" : "off"
  }`
);

// Exporta el pool (compatible con db.query y db.connect)
export default {
  query: (text, params) => pool.query(text, params),
  connect: () => pool.connect(),
  _pool: pool, // por si necesitas acceder al Pool nativo
};
