// src/pages/Login.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Login.css";               // tu CSS original (si lo usas)
import "./LoginPaletteDark.css";    // paleta y estilo final (oscuro + pills)

/* ========= Base de API robusta =========
   - Respeta VITE_API_URL si ya termina en /api o /backend/api
   - Si no, agrega /api por defecto
   - api(path) limpia "/" inicial y un "api/" accidental para evitar /api/api
*/
const API_BASE = (() => {
  const raw = (import.meta.env.VITE_API_URL || "http://localhost:3001/api")
    .trim()
    .replace(/\/+$/, "");
  if (/\/(backend\/)?api$/i.test(raw)) return raw; // ya incluye /api
  return `${raw}/api`;
})();

const api = (p = "") => {
  const cleaned = String(p || "")
    .replace(/^\/+/, "")        // quita / iniciales
    .replace(/^api\/+/i, "");   // evita un api/ accidental => /api/api
  return `${API_BASE}/${cleaned}`;
};

const jsonHeaders = (token) => ({
  "Content-Type": "application/json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

export default function Login() {
  const navigate = useNavigate();
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const url = api("auth/login");
      const payload = {
        correo,
        password: contrasena,
        contrasena: contrasena,
        contraseña: contrasena,
      };

      console.log("[LOGIN] POST", url);
      console.log("[LOGIN] payload (safe):", { ...payload, password: "***", contrasena: "***", contraseña: "***" });

      const res = await fetch(url, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      console.log("[LOGIN] status:", res.status, "body:", data);

      if (res.status === 404) { setError("Usuario no encontrado."); return; }
      if (res.status === 401) { setError("Contraseña incorrecta."); return; }
      if (!res.ok)            { setError(data?.message || data?.error || `Error ${res.status}`); return; }

      const userRaw = data.user ?? data.data ?? data ?? {};
      const token   = data.token ?? userRaw.token ?? null;

      const idUsuario =
        userRaw.id_usuario ??
        userRaw.usuario?.id_usuario ??
        userRaw.user?.id_usuario ??
        userRaw.id ??
        null;

      const idEstudiante =
        userRaw.id_estudiante ??
        userRaw.estudiante?.id_estudiante ??
        null;

      const role =
        userRaw.id_rol ??
        userRaw.role ??
        userRaw.rol ??
        null;

      const nombre =
        userRaw.nombre ??
        userRaw.usuario?.Nombre ??
        userRaw.user?.nombre ??
        userRaw.displayName ??
        "Usuario";

      const auth = {
        idUsuario,
        idEstudiante,
        role,
        nombre,
        correo: userRaw.correo ?? correo,
        carne_estudiante: userRaw.carne_estudiante ?? null,
        id_grado: userRaw.id_grado ?? null,
        token,
      };

      localStorage.setItem("auth", JSON.stringify(auth));
      if (token) localStorage.setItem("token", token);
      if (role != null) localStorage.setItem("rol", String(role));
      if (idUsuario != null) localStorage.setItem("id_usuario", String(idUsuario));
      localStorage.setItem("nombre", nombre);
      localStorage.setItem("correo", auth.correo || correo);

      const r = String(role ?? "");
      if (r === "1")       navigate("/admin", { replace: true });
      else if (r === "2")  navigate("/docente/monitoreo", { replace: true });
      else if (r === "3")  navigate("/estudiante", { replace: true });
      else                 setError("Rol de usuario no válido.");
    } catch (err) {
      console.error("[LOGIN] catch:", err);
      setError(err?.message || "No se pudo iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">{/* scope de estilos – no afecta otras vistas */}
      <div className="login-card">
        <div className="login-avatar" aria-hidden="true">
          <svg width="90" height="90" viewBox="0 0 100 100">
            <circle cx="50" cy="36" r="24" fill="#fff" />
            <ellipse cx="50" cy="74" rx="34" ry="23" fill="#fff" />
          </svg>
        </div>

        <h2 className="login-title">USER LOGIN</h2>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <span className="input-icon" aria-hidden="true">
              <svg width="20" height="20" fill="#cfd5ff" viewBox="0 0 448 512">
                <path d="M224 256A128 128 0 1 0 224 0a128 128 0 1 0 0 256zM313.6 288h-16.7c-22.2 10.2-46.9 16-72.9 16s-50.7-5.8-72.9-16h-16.7C60.2 288 0 348.2 0 422.4C0 457.4 25.1 480 56.7 480H391.3c31.6 0 56.7-22.6 56.7-57.6c0-74.2-60.2-134.4-134.4-134.4z" />
              </svg>
            </span>
            <input
              type="email"
              placeholder="Correo"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="input-group">
            <span className="input-icon" aria-hidden="true">
              <svg width="20" height="20" fill="#cfd5ff" viewBox="0 0 448 512">
                <path d="M400 224H384V144C384 64.5 319.5 0 240 0S96 64.5 96 144v80H80c-26.5 0-48 21.5-48 48v192c0 26.5 21.5 48 48 48h320c26.5 0 48-21.5 48-48V272c0-26.5-21.5-48-48-48zM144 144c0-52.9 43.1-96 96-96s96 43.1 96 96v80H144v-80zm224 320H80V272h288v192z" />
              </svg>
            </span>
            <input
              type="password"
              placeholder="Contraseña"
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div style={{ color: "#ff6b6b", marginBottom: 10 }}>{error}</div>
          )}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? "Entrando..." : "LOGIN"}
          </button>
        </form>
      </div>
    </div>
  );
}
