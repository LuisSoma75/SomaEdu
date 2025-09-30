// src/pages/Login.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Login.css";

/* ========= Base de API robusta =========
   Lee VITE_API_URL. Si ya termina en /api o /backend/api lo respeta.
   Si no, agrega /api por defecto.
*/
const API_BASE = (() => {
  const env = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").trim();
  if (/\/(backend\/)?api\/?$/i.test(env)) {
    return env.replace(/\/+$/, "");
  }
  return (env.replace(/\/+$/, "") + "/api").replace(/\/+$/, "");
})();
const api = (path = "") => `${API_BASE}/${String(path || "").replace(/^\/+/, "")}`;

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
      // IMPORTANTE: no agregues /api aquí; API_BASE YA lo incluye (/backend/api en tu caso)
      const url = api("login"); // -> http://localhost:3001/backend/api/login
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Enviamos ambas variantes por compatibilidad con el backend
        body: JSON.stringify({ correo, contrasena, contraseña: contrasena }),
      });

      const data = await res.json().catch(() => ({}));

      // Soporta {ok:true, user:{...}} o {success:true, ...}
      const ok = (res.ok && (data.ok ?? data.success ?? false)) || false;
      if (!ok) {
        const msg = data?.message || data?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const user = data.user ?? data.data ?? data;

      // Normaliza campos esperados por el resto del front
      const idUsuario = user.id_usuario ?? user.idUsuario ?? null;
      const idEstudiante = user.id_estudiante ?? user.idEstudiante ?? null;
      const role = user.role ?? user.id_rol ?? null;
      const nombre =
        user.nombre ??
        user.usuario?.Nombre ??
        user.user?.nombre ??
        "Usuario";
      const token = user.token ?? null;

      const auth = {
        idUsuario,
        idEstudiante,
        role,
        nombre,
        correo: user.correo ?? correo,
        carne_estudiante: user.carne_estudiante ?? null,
        id_grado: user.id_grado ?? null,
        token,
      };
      localStorage.setItem("auth", JSON.stringify(auth));

      // Compatibilidad con código legado (si algo del front aún lee estas claves)
      localStorage.setItem("nombre", nombre);
      if (role != null) localStorage.setItem("rol", String(role));
      if (idUsuario != null) localStorage.setItem("id_usuario", String(idUsuario));
      localStorage.setItem("correo", auth.correo || correo);

      // Redirección según rol (acepta number o string)
      const r = String(role ?? "");
      if (r === "1") navigate("/admin", { replace: true });
      else if (r === "2") navigate("/docente", { replace: true });
      else if (r === "3") navigate("/estudiante", { replace: true });
      else setError("Rol de usuario no válido.");
    } catch (err) {
      console.error("[LOGIN] error:", err);
      setError(err.message || "No se pudo iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-avatar">
          <svg width="90" height="90" viewBox="0 0 100 100">
            <circle cx="50" cy="36" r="24" fill="#fff" />
            <ellipse cx="50" cy="74" rx="34" ry="23" fill="#fff" />
          </svg>
        </div>

        <h2 className="login-title">USER LOGIN</h2>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <span className="input-icon">
              <svg width="20" height="20" fill="#585e68" viewBox="0 0 448 512">
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
            <span className="input-icon">
              <svg width="20" height="20" fill="#585e68" viewBox="0 0 448 512">
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
            <div style={{ color: "#ff4343", marginBottom: 10 }}>{error}</div>
          )}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? "Entrando..." : "LOGIN"}
          </button>
        </form>
      </div>
    </div>
  );
}
