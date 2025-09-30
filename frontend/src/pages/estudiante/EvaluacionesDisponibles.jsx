// src/pages/estudiante/EvaluacionesDisponibles.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StudentSidebar from "../../components/StudentSidebar";
import "./EvaluacionesDisponibles.css";

/* ===========================
   Base de API robusta
   - Lee VITE_API_URL si existe
   - Si no termina en /backend/api, lo agrega
=========================== */
const API_BASE = (() => {
  const env = (import.meta.env.VITE_API_URL || "http://localhost:3001/backend/api").trim();
  // Si no incluye /backend/api al final, lo añadimos
  const withBackendApi = /\/backend\/api\/?$/i.test(env)
    ? env
    : env.replace(/\/+$/, "") + "/backend/api";
  return withBackendApi.replace(/\/+$/, "");
})();
const api = (path = "") => `${API_BASE}/${String(path || "").replace(/^\/+/, "")}`;

export default function EvaluacionesDisponibles() {
  const navigate = useNavigate();

  // -------- auth ----------
  const auth = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("auth") || "{}");
    } catch {
      return {};
    }
  }, []);

  const idUsuario =
    auth.id_usuario ?? auth.idUsuario ?? auth.userId ?? null;
  const idEstudiante =
    auth.id_estudiante ?? auth.idEstudiante ?? null;

  // -------- estado UI ----------
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState("");
  const [items, setItems] = useState([]);

  // -------- acciones ----------
  const handleLogout = () => {
    try {
      localStorage.removeItem("auth");
      localStorage.removeItem("nombre");
      localStorage.removeItem("rol");
      localStorage.removeItem("id_usuario");
      localStorage.removeItem("correo");
      localStorage.removeItem("carne_estudiante");
    } finally {
      navigate("/", { replace: true });
    }
  };

  const goToSala = (it) => {
    const param = it.pin ? it.pin : it.id_sesion;
    navigate(`/estudiante/sala/${param}`);
  };

  // -------- carga desde API ----------
  useEffect(() => {
    let cancel = false;

    async function load() {
      setLoading(true);
      setError("");
      setItems([]);

      // Elegimos endpoint según lo disponible en auth
      let url = idEstudiante
        ? api(`estudiantes/${idEstudiante}/evaluaciones`)
        : idUsuario
        ? api(`estudiantes/by-user/${idUsuario}/evaluaciones`)
        : null;

      if (!url) {
        setError("No se encontró el identificador del estudiante.");
        setLoading(false);
        return;
      }

      try {
        // Útil para depurar
        console.log("[API_BASE]", API_BASE);
        console.log("[GET]", url);

        const r = await fetch(url, { headers: { "Content-Type": "application/json" } });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg = j?.error || `HTTP ${r.status}`;
          throw new Error(msg);
        }

        const arr = Array.isArray(j.items) ? j.items : [];
        const norm = arr.map((x) => ({
          id_sesion: x.id_sesion ?? x.id ?? null,
          titulo: x.titulo ?? x.nombre ?? "Evaluación",
          grado: x.id_grado ?? x.grado ?? x.grado_nombre ?? x.clase_nombre ?? null,
          materia: x.materia ?? x.materia_nombre ?? null,
          fecha: x.fecha ?? x.creado_en ?? null,
          estado: x.estado ?? "Disponible",
          modalidad:
            x.modalidad ??
            (x.tiempo_limite_seg ? "tiempo" : x.num_preg_max ? "num_preguntas" : "hasta_detener"),
          minutos: x.tiempo_limite_seg ? Math.round(Number(x.tiempo_limite_seg) / 60) : null,
          num_preguntas: x.num_preg_max ?? null,
          pin: x.pin ?? null,
          clase_nombre: x.clase_nombre ?? null,
        })).filter(e => e.id_sesion != null);

        if (!cancel) setItems(norm);
      } catch (e) {
        console.error("[Evaluaciones] Error:", e);
        if (!cancel) setError("No se pudieron cargar las evaluaciones desde la API.");
      } finally {
        if (!cancel) setLoading(false);
      }
    }

    load();
    return () => {
      cancel = true;
    };
  }, [idUsuario, idEstudiante]); // API_BASE es constante; no recargar por eso

  const list = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return items;
    return items.filter((x) =>
      [x.titulo, x.grado, x.materia, x.clase_nombre]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q))
    );
  }, [items, filtro]);

  return (
    <div className="student-page">
      <StudentSidebar activeKey="evaluaciones" />

      <main className="main-content">
        <header className="edb-header">
          <div>
            <h1 className="edb-title">Evaluaciones disponibles</h1>
            <p className="edb-sub">Selecciona una evaluación para entrar a la sala de espera.</p>
          </div>
          <div className="edb-quick" style={{ gap: 12, display: "flex", alignItems: "center" }}>
            <input
              className="inp"
              placeholder="Buscar por nombre, materia o grado…"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
            <button className="btn ghost" onClick={() => navigate("/estudiante")}>Volver</button>
            <button className="btn danger" onClick={handleLogout}>Cerrar sesión</button>
          </div>
        </header>

        <section className="card">
          {loading ? (
            <div className="skeleton">Cargando evaluaciones…</div>
          ) : (
            <>
              {error && <div className="alert warning">{error}</div>}

              {list.length === 0 ? (
                <div className="empty">No hay evaluaciones disponibles para tu grado.</div>
              ) : (
                <table className="table ev-table">
                  <thead>
                    <tr>
                      <th>Título</th>
                      <th>Grado</th>
                      <th>Materia</th>
                      <th>Modalidad</th>
                      <th>Fecha</th>
                      <th>Estado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((e) => (
                      <tr key={e.id_sesion}>
                        <td>
                          <div className="t-title">{e.titulo}</div>
                          <div className="muted t-sub">
                            {e.clase_nombre ? `Clase: ${e.clase_nombre} • ` : ""}
                            PIN: {e.pin ?? "—"}
                          </div>
                        </td>
                        <td>{e.grado ?? "—"}</td>
                        <td>{e.materia ?? "—"}</td>
                        <td className="muted">
                          {e.modalidad === "tiempo"
                            ? `Tiempo${e.minutos ? ` • ${e.minutos} min` : ""}`
                            : e.modalidad === "num_preguntas"
                            ? `${e.num_preguntas ?? "N"} preguntas`
                            : "Hasta detener"}
                        </td>
                        <td>{e.fecha ? String(e.fecha).slice(0, 10) : "—"}</td>
                        <td>
                          <span className={`pill ${String(e.estado).toLowerCase()}`}>{e.estado}</span>
                        </td>
                        <td className="t-right">
                          <button className="btn primary sm" onClick={() => goToSala(e)}>
                            Entrar a sala
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
