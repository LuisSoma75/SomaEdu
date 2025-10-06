// api/services/ia.cjs  (CommonJS)
// Cliente del microservicio de IA con configuración por ENV y timeout.
// Si la IA está deshabilitada (IA_DISABLED=1) o no responde a tiempo,
// devolvemos { items: [] } para que el controlador use el fallback SQL.

const IA_BASE =
  (process.env.IA_URL || process.env.IA_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const IA_TIMEOUT_MS = Number(process.env.IA_TIMEOUT_MS || 2000); // 2s por defecto
const IA_DISABLED = String(process.env.IA_DISABLED || "").trim() === "1";

// Node 18+ trae fetch y AbortController globales.
async function rank({ id_materia, target_valor, exclude = [], k = 1 }) {
  if (IA_DISABLED) {
    // Permite forzar el uso del fallback sin levantar la IA
    return { ok: false, items: [] };
  }

  const url = `${IA_BASE}/rank`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IA_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id_materia, target_valor, exclude, k }),
      signal: ctrl.signal,
    });

    const bodyText = await res.text();

    if (!res.ok) {
      // Devolvemos vacío para que el controlador active el fallback SQL
      return { ok: false, items: [], status: res.status, error: bodyText };
    }

    try {
      return JSON.parse(bodyText);
    } catch (e) {
      // Si la IA responde con algo no-JSON, también activamos fallback
      return { ok: false, items: [], error: `JSON parse error: ${e.message}`, raw: bodyText };
    }
  } catch (err) {
    // Abort/timeout/ECONNREFUSED -> fallback
    return { ok: false, items: [], error: err.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { rank };
