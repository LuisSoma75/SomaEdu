// frontend/src/utils/api.js
// Base de la API: confía 100% en VITE_API_URL o usa el fallback con /backend/api
export const API_BASE = (
  import.meta.env.VITE_API_URL || "http://localhost:3001/backend/api"
).replace(/\/+$/, ""); // sin "/" al final

/** Une base + path sin dobles slashes */
export function api(path = "") {
  const p = String(path || "").replace(/^\/+/, ""); // sin "/" inicial
  return `${API_BASE}/${p}`;
}
