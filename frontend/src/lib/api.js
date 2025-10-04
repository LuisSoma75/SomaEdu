// src/lib/api.js
export const API_BASE = (() => {
  const raw = (import.meta.env.VITE_API_URL || "http://localhost:3001/api")
    .trim()
    .replace(/\/+$/, "");
  // respeta si ya termina en /api o /backend/api
  if (/\/(backend\/)?api$/i.test(raw)) return raw;
  return `${raw}/api`;
})();

export const api = (path = "") => {
  // quita "/" inicial y también un "api/" accidental
  const cleaned = String(path || "")
    .replace(/^\/+/, "")
    .replace(/^api\/+/i, ""); // <- evita /api/api
  return `${API_BASE}/${cleaned}`;
};

export const authHeaders = (token) => ({
  Authorization: token ? `Bearer ${token}` : "",
  "Content-Type": "application/json",
});
