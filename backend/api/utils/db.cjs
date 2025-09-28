// api/utils/db.cjs  (CommonJS)
const { Pool } = require("pg");

// Usa la misma URL que ya usas en .env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLED,
  ssl: { rejectUnauthorized: false }, // Neon/Cloud suele requerir SSL
});

// Exporta un objeto con .query para que sea compatible con tu controller
module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
