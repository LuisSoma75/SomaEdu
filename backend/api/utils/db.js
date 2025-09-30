// backend/api/utils/db.js
import pkg from "pg";
const { Pool } = pkg;

/* --------- Config de conexión --------- */
const CONNECTION_STRING =
  process.env.DATABASE_URL_POOLED ||
  process.env.DATABASE_URL ||
  process.env.PGURL ||
  process.env.POSTGRES_URL ||
  "";

/** Convierte strings de env a booleanos */
function parseBool(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return null;
}

/** Decide si usar SSL */
const envSSL =
  parseBool(process.env.PGSSL) ??
  parseBool(process.env.DATABASE_SSL);

const shouldUseSSL = (() => {
  if (envSSL !== null) return envSSL;
  if (/\bsslmode=require\b/i.test(CONNECTION_STRING)) return true;
  if (/(neon\.tech|render\.com|supabase\.co|herokuapp\.com)/i.test(CONNECTION_STRING)) return true;
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
})();

/* --------- Pool --------- */
const pool = new Pool({
  connectionString: CONNECTION_STRING || undefined,
  ssl: shouldUseSSL ? { rejectUnauthorized: false } : false, // Neon requiere TLS
  max: Number(process.env.PGPOOL_MAX || 5),                  // Neon no necesita pools grandes
  idleTimeoutMillis: Number(process.env.PG_IDLE || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT || 10000),
  keepAlive: true,
});

pool.on("error", (err) => {
  console.error("[DB] Pool error:", err);
});

/* --------- Log SQL opcional --------- */
function logSQL(text, params) {
  if (String(process.env.DEBUG_SQL || "") !== "1") return;
  // Sanitiza params (por si alguno es sensible)
  const safeParams = Array.isArray(params)
    ? params.map((p) => (typeof p === "string" && p.length > 200 ? p.slice(0, 200) + "…[truncated]" : p))
    : params;
  console.log("[SQL]", text.replace(/\s+/g, " ").trim(), "| params:", safeParams);
}

/* --------- Helpers --------- */
export async function pingDB() {
  try {
    const r = await pool.query("select now() as now");
    console.log("[DB] Connected. now():", r.rows[0].now);
  } catch (e) {
    console.error("[DB] Connection error:", e);
  }
}

/* --------- Export default (interfaz cómoda) --------- */
const db = {
  query: (text, params) => {
    logSQL(text, params);
    return pool.query(text, params);
  },
  connect: () => pool.connect(),
  _pool: pool,
};

export default db;

// Log inicial útil
console.log(
  `[DB] Using ${CONNECTION_STRING ? "DATABASE_URL*" : "local config"} | SSL: ${shouldUseSSL ? "on" : "off"}`
);
