// src/components/StudentSidebar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import "./StudentSidebar.css";

const API = import.meta.env?.VITE_API_URL || "http://localhost:3001";

const Icon = {
  dashboard: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
    </svg>
  ),
  tests: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h10a2 2 0 0 1 2 2v2H5V5a2 2 0 0 1 2-2zm12 6H5v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9zM8 12h8v2H8v-2zm0 4h5v2H8v-2z" />
    </svg>
  ),
  history: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7v4l5-5-5-5v4zM12 8h2v6h-6v-2h4V8z" />
    </svg>
  ),
  profile: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4.33 0-8 2.17-8 5v1h16v-1c0-2.83-3.67-5-8-5z" />
    </svg>
  ),
  report: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h10a2 2 0 0 1 2 2v14l-4-2-4 2-4-2-4 2V5a2 2 0 0 1 2-2zm2 4h6v2H9V7zm0 4h6v2H9v-2z" />
    </svg>
  ),
  menu: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z" />
    </svg>
  ),
  collapse: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 12l5-5 5 5H7zm0 0l5 5 5-5H7z" />
    </svg>
  ),
};

export default function StudentSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // ---- auth básico desde localStorage ----
  const auth = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("auth") || "{}");
    } catch {
      return {};
    }
  }, []);
  const idUsuario = auth.id_usuario ?? auth.idUsuario ?? auth.userId ?? null;

  // Perfil mostrado en el header del sidebar
  const [perfil, setPerfil] = useState({
    nombre: auth.nombre || "Estudiante",
    grado: null,
  });

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    return () => document.body.classList.remove("sidebar-collapsed");
  }, [collapsed]);

  // Cargar grado/nombre desde la API por id_usuario
  useEffect(() => {
    if (!idUsuario) return;
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/estudiantes/by-user/${idUsuario}/resumen`);
        const j = await r.json();
        if (!cancel && j?.ok) {
          setPerfil((p) => ({
            ...p,
            nombre: j.data?.nombre_completo || p.nombre,
            grado: j.data?.grado || null,
          }));
        }
      } catch {
        // silencioso
      }
    })();
    return () => {
      cancel = true;
    };
  }, [idUsuario]);

  // Cerrar en navegación móvil
  const handleNavClick = () => {
    if (mobileOpen) setMobileOpen(false);
  };

  return (
    <>
      <button
        className="sb-mobile-trigger"
        onClick={() => setMobileOpen(true)}
        aria-label="Abrir menú"
      >
        <Icon.menu />
      </button>

      {mobileOpen && <div className="sb-backdrop" onClick={() => setMobileOpen(false)} />}

      <aside className={`sb ${collapsed ? "collapsed" : ""} ${mobileOpen ? "open" : ""}`}>
        <header className="sb-header">
          <div className="sb-logo" onClick={() => setCollapsed(false)}>
            <span className="logo-mark">SE</span>
            <span className="logo-text">SomaEdu</span>
          </div>
          <button
            className="sb-collapse"
            onClick={() => setCollapsed((v) => !v)}
            aria-label="Colapsar menú"
            title="Colapsar/Expandir"
          >
            <Icon.collapse />
          </button>
        </header>

        <div className="sb-profile">
          <div className="avatar">E</div>
          <div className="info">
            <div className="name">{perfil.nombre || "Estudiante"}</div>
            <div className="meta">{perfil.grado ? `Grado ${perfil.grado}` : "Grado • Sección"}</div>
          </div>
        </div>

        <nav className="sb-nav" onClick={handleNavClick}>
          <NavLink
            end
            to="/estudiante"
            className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`}
          >
            <span className="sb-icon">
              <Icon.dashboard />
            </span>
            <span className="sb-label">Inicio</span>
          </NavLink>

          <NavLink
            to="/estudiante/evaluaciones"
            className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`}
          >
            <span className="sb-icon">
              <Icon.tests />
            </span>
            <span className="sb-label">Evaluaciones</span>
          </NavLink>

          <NavLink
            to="/estudiante/historial"
            className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`}
          >
            <span className="sb-icon">
              <Icon.history />
            </span>
            <span className="sb-label">Historial</span>
          </NavLink>

          <NavLink
            to="/estudiante/perfil"
            className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`}
          >
            <span className="sb-icon">
              <Icon.profile />
            </span>
            <span className="sb-label">Perfil</span>
          </NavLink>

          <NavLink
            to="/estudiante/reporte"
            className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`}
          >
            <span className="sb-icon">
              <Icon.report />
            </span>
            <span className="sb-label">Reporte de desempeño</span>
          </NavLink>
        </nav>

        <footer className="sb-footer">
          <small>SomaEdu • v1.0</small>
        </footer>
      </aside>
    </>
  );
}
