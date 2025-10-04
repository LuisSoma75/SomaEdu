// src/pages/estudiante/EvaluacionesDisponibles.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StudentSidebar from "../../components/StudentSidebar";
import "./EvaluacionesDisponibles.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

// Toggle de logs locales de esta vista
const DBG = true;
const log = (...a) => DBG && console.log("[EVALUACIONES]", ...a);
const warn = (...a) => DBG && console.warn("[EVALUACIONES]", ...a);

export default function EvaluacionesDisponibles() {
  const navigate = useNavigate();

  // -------- auth ----------
  const auth = useMemo(() => {
    try {
      const raw = localStorage.getItem("auth") || "{}";
      log("auth RAW:", raw);
      const parsed = JSON.parse(raw);
      log("auth PARSED:", parsed);
      return parsed;
    } catch {
      warn("No se pudo parsear localStorage.auth");
      return {};
    }
  }, []);

  const idUsuario = auth.id_usuario ?? auth.idUsuario ?? auth.userId ?? null;
  const carne = auth.carne_estudiante ?? auth.carne ?? null;
  log("auth.normalizado ->", { idUsuario, carne });

  // -------- estado UI ----------
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState("");
  const [items, setItems] = useState([]);

  // -------- handlers ----------
  const handleLogout = () => {
    log("Logout click");
    try {
      localStorage.removeItem("auth");
      // limpiar llaves antiguas por compatibilidad
      localStorage.removeItem("nombre");
      localStorage.removeItem("rol");
      localStorage.removeItem("id_usuario");
      localStorage.removeItem("correo");
      localStorage.removeItem("carne_estudiante");
    } finally {
      navigate("/", { replace: true });
    }
  };

  // 👉 Ahora lleva directo a resolver
  const goToSala = (idSesion) => {
    log("click Resolver >", { idSesion });
    navigate(`/estudiante/resolver/${idSesion}`);
  };

  // -------- carga desde API (con fallback) ----------
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setError("");

      const endpoints = [
        `${API}/api/estudiante/evaluaciones?userId=${idUsuario ?? ""}`,
        `${API}/api/estudiante/evaluaciones?carne=${encodeURIComponent(carne ?? "")}`,
        `${API}/api/sesiones/disponibles?userId=${idUsuario ?? ""}`,
      ].filter(Boolean);

      log("Intentando cargar evaluaciones desde:", endpoints);

      let ok = false;
      for (const url of endpoints) {
        try {
          const r = await fetch(url, { headers: { "Content-Type": "application/json" } });
          log("fetch:", url, "->", r.status);
          if (!r.ok) continue;

          const j = await r.json();
          const raw = j.items ?? j.data ?? j ?? [];
          const arr = Array.isArray(raw) ? raw : [];
          const norm = arr
            .map((x) => ({
              id: x.id ?? x.id_sesion ?? x.sessionId ?? x.sesion_id ?? null,
              titulo: x.titulo ?? x.nombre ?? "Evaluación",
              grado: x.grado ?? x.grado_nombre ?? null,
              materia: x.materia ?? x.materia_nombre ?? null,
              fecha: x.fecha ?? x.creado_en ?? null,
              estado: x.estado ?? "Disponible",
              modalidad:
                x.modalidad ??
                (x.tiempo_limite_seg ? "Tiempo" : (x.num_preg_max ? "# Preguntas" : "Hasta detener")),
              minutos:
                x.minutos ??
                (x.tiempo_limite_seg ? Math.round(Number(x.tiempo_limite_seg) / 60) : null),
              num_preguntas: x.num_preguntas ?? x.num_preg_max ?? null,
              docente: x.docente ?? x.docente_nombre ?? null,
            }))
            .filter((e) => e.id != null);

          log("normalizados =", norm.length, "items");
          if (!cancel) setItems(norm);
          ok = true;
          break;
        } catch (e) {
          warn("Error cargando", url, e);
        }
      }

      if (!ok && !cancel) {
        warn("Fallo carga API, usando fallback");
        setItems([
          {
            id: 101,
            titulo: "Adaptativa CNB",
            grado: null,
            materia: null,
            fecha: null,
            estado: "Disponible",
            modalidad: "Hasta detener",
            minutos: null,
            docente: null,
          },
        ]);
        setError("No se pudo cargar desde la API; mostrando ejemplo.");
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API, idUsuario, carne]);

  const list = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return items;
    const filtered = items.filter((x) =>
      [x.titulo, x.grado, x.materia, x.docente]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q))
    );
    log("Filtro=", q, " -> ", filtered.length, "items");
    return filtered;
  }, [items, filtro]);

  return (
    <div className="student-page" data-testid="evaluaciones-page">
      <StudentSidebar activeKey="evaluaciones" />

      <main className="main-content">
        <header className="edb-header">
          <div>
            <h1 className="edb-title">Evaluaciones disponibles</h1>
            <p className="edb-sub">Selecciona una evaluación para resolverla.</p>
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
                <div className="empty">No hay evaluaciones disponibles por ahora.</div>
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
                      <tr key={e.id}>
                        <td>
                          <div className="t-title">{e.titulo}</div>
                          {e.docente && <div className="muted t-sub">Docente: {e.docente}</div>}
                        </td>
                        <td>{e.grado ?? "—"}</td>
                        <td>{e.materia ?? "—"}</td>
                        <td className="muted">
                          {e.modalidad}
                          {e.minutos ? ` • ${e.minutos} min` : ""}
                          {e.num_preguntas ? ` • ${e.num_preguntas} preguntas` : ""}
                        </td>
                        <td>{e.fecha ? String(e.fecha).slice(0, 10) : "—"}</td>
                        <td><span className={`pill ${String(e.estado).toLowerCase()}`}>{e.estado}</span></td>
                        <td className="t-right">
                          <button
                            className="btn primary sm"
                            data-testid={`btn-resolver-${e.id}`}
                            onClick={() => goToSala(e.id)}
                          >
                            Resolver
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
