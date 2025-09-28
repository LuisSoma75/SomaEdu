// backend/api/utils/db.js
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon requiere SSL
  max: 5,                    // Neon no necesita pools grandes
  idleTimeoutMillis: 30000,  // cierra conexiones ociosas
  connectionTimeoutMillis: 10000,
  keepAlive: true
});

export default pool;
