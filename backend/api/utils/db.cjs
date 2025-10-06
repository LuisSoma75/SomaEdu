// api/utils/db.cjs  (CommonJS)
const { Pool } = require("pg");

/* ================================
   Config de conexión
================================ */
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

/* ================================
   Decidir SSL de forma robusta
================================ */
const envDisableSSL = parseBool(process.env.PGSSL_DISABLE); // fuerza OFF si =1/true
const envSSL =
  parseBool(process.env.PGSSL) ??
  parseBool(process.env.DATABASE_SSL);

const isLocalConn = /(?:^|@)(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(CONNECTION_STRING);

let ssl;
if (envDisableSSL === true) {
  ssl = false;
} else if (envSSL !== null) {
  ssl = envSSL ? { rejectUnauthorized: false } : false;
} else if (/\b(sslmode=require|ssl=true)\b/i.test(CONNECTION_STRING)) {
  ssl = { rejectUnauthorized: false };
} else if (isLocalConn) {
  ssl = false;
} else if (/(neon\.tech|render\.com|supabase\.co|herokuapp\.com)/i.test(CONNECTION_STRING)) {
  ssl = { rejectUnauthorized: false };
} else {
  // por defecto: producción -> ON, dev -> OFF
  ssl = String(process.env.NODE_ENV || "").toLowerCase() === "production"
    ? { rejectUnauthorized: false }
    : false;
}

/* ================================
   Pool PG
================================ */
const pool = new Pool({
  connectionString: CONNECTION_STRING || undefined,
  ssl,
  max: Number(process.env.PGPOOL_MAX || 5),
  idleTimeoutMillis: Number(process.env.PG_IDLE || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT || 10000),
  keepAlive: true,
});

pool.on("error", (err) => {
  console.error("[DB.cjs] Pool error:", err);
});

/* ================================
   Log SQL opcional
================================ */
function logSQL(text, params) {
  if (String(process.env.DEBUG_SQL || "") !== "1") return;
  const safeParams = Array.isArray(params)
    ? params.map((p) =>
        typeof p === "string" && p.length > 200 ? p.slice(0, 200) + "…[truncated]" : p
      )
    : params;
  console.log("[SQL]", String(text).replace(/\s+/g, " ").trim(), "| params:", safeParams);
}

/* ================================
   API
================================ */
async function query(text, params) {
  logSQL(text, params);
  return pool.query(text, params);
}
function connect() {
  return pool.connect();
}

module.exports = { query, connect, _pool: pool, pool };

// Log inicial para verificar SSL ON/OFF
console.log(
  `[DB.cjs] Using ${CONNECTION_STRING ? "DATABASE_URL*" : "local config"} | SSL: ${
    ssl ? "on" : "off"
  }${envDisableSSL ? " (PGSSL_DISABLE)" : isLocalConn ? " (local)" : ""}`
);
