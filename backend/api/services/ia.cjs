// api/services/ia.cjs  (CommonJS)
const IA_BASE = process.env.IA_BASE_URL || "http://127.0.0.1:8000";

// Node 18+ ya trae fetch global. No uses node-fetch aquí.
async function rank({ id_materia, target_valor, exclude = [], k = 1 }) {
  const url = `${IA_BASE.replace(/\/$/, "")}/rank`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_materia, target_valor, exclude, k }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`IA /rank ${res.status} ${res.statusText}: ${body}`);
  }
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error(`IA /rank JSON parse error: ${e.message}; body=${body}`);
  }
}

module.exports = { rank };
