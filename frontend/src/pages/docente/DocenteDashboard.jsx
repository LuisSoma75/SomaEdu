import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./DocenteDashboard.css";

export default function DocenteDashboard() {
  const navigate = useNavigate();

  // Info docente
  let nombreUsuario = localStorage.getItem("nombre");
  if (!nombreUsuario || nombreUsuario === "undefined") nombreUsuario = "Docente";
  const nombreConPrefijo = `Prof. ${nombreUsuario}`;
  const id_usuario = localStorage.getItem("id_usuario");

  // Estado de clases
  const [clases, setClases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Datos demo (puedes conectar a tu backend real cuando gustes)
  const evaluacionesRecientes = [
    { id: 1, fecha: "2025-07-31", materia: "Matemática", estado: "Finalizada" },
    { id: 2, fecha: "2025-07-28", materia: "Ciencias", estado: "En curso" },
  ];
  const estudiantesDestacados = [
    { nombre: "María García", logro: "Mayor progreso" },
    { nombre: "Luis Pérez", logro: "Mejor promedio" },
  ];
  const alertas = [
    { estudiante: "Ana López", grupo: "2A", materia: "Matemática", motivo: "Bajo desempeño" },
    { estudiante: "Carlos Díaz", grupo: "3B", materia: "Ciencias", motivo: "Faltas frecuentes" },
  ];

  // Cargar clases del docente al montar
  useEffect(() => {
    const api = import.meta.env.VITE_API_URL || "http://localhost:3001";
    const fetchClases = async () => {
      setLoading(true);
      setError("");
      try {
        if (!id_usuario) {
          setClases([]);
          return;
        }
        const res = await fetch(`${api}/api/docente/clases/${id_usuario}`);
        const data = await res.json();
        setClases(Array.isArray(data) ? data : []);
      } catch (_e) {
        setError("No se pudieron cargar las clases.");
      } finally {
        setLoading(false);
      }
    };
    fetchClases();
  }, [id_usuario]);

  const totalClases = useMemo(() => clases.length, [clases]);
  const evalsEnCurso = useMemo(
    () => evaluacionesRecientes.filter((e) => e.estado?.toLowerCase() === "en curso").length,
    [evaluacionesRecientes]
  );

  const saludo = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "¡Buenos días!";
    if (h < 18) return "¡Buenas tardes!";
    return "¡Buenas noches!";
  }, []);

  return (
    <>
      <header className="tdb-header">
        <div>
          <h1 className="tdb-title">
            {saludo} {nombreConPrefijo}
          </h1>
          <p className="tdb-sub">Panel docente • Gestión y monitoreo</p>
        </div>
        <div className="tdb-quick">
          <button className="btn primary" onClick={() => navigate("/docente/evaluaciones")}>
            Crear evaluación
          </button>
          <button className="btn ghost" onClick={() => navigate("/docente/monitoreo")}>
            Monitoreo
          </button>
        </div>
      </header>

      <section className="grid">
        {/* Resumen general */}
        <article className="card span-2">
          <h2 className="card-title">Resumen general</h2>
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">Clases asignadas</div>
              <div className="kpi-value">{totalClases}</div>
              <Progress value={Math.min(100, totalClases * 20)} />
            </div>
            <div className="kpi">
              <div className="kpi-label">Evals en curso</div>
              <div className="kpi-value">{evalsEnCurso}</div>
              <Progress value={evalsEnCurso ? 70 : 20} />
            </div>
            <div className="kpi trend">
              <div className="kpi-label">Actividad</div>
              <div className="badge up">▲ saludable</div>
            </div>
          </div>

          <div className="areas">
            <div className="area">
              <div className="area-top">
                <span className="area-name">Acción rápida</span>
                <span className="area-val">Evaluaciones</span>
              </div>
              <div className="area-actions">
                <button className="btn sm" onClick={() => navigate("/docente/evaluaciones")}>
                  Nueva
                </button>
                <button className="btn sm" onClick={() => navigate("/docente/historial")}>
                  Historial
                </button>
                <button className="btn sm" onClick={() => navigate("/docente/reportes")}>
                  Reportes
                </button>
              </div>
            </div>

            <div className="area">
              <div className="area-top">
                <span className="area-name">Clases</span>
                <span className="area-val">{totalClases}</span>
              </div>
              <div className="grupos-list dark">
                {loading ? (
                  <div className="muted">Cargando clases…</div>
                ) : error ? (
                  <div className="muted" style={{ color: "#fca5a5" }}>
                    {error}
                  </div>
                ) : totalClases === 0 ? (
                  <div className="muted">Sin clases asignadas.</div>
                ) : (
                  clases.slice(0, 6).map((c) => (
                    <div className="grupo-chip" key={c.id_clase}>
                      <strong>{c.materia}</strong> • {c.grado} • {c.estudiantes} est.
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </article>

        {/* Evaluaciones recientes */}
        <article className="card">
          <h2 className="card-title">Evaluaciones recientes</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Materia</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {evaluacionesRecientes.map((ev) => (
                <tr key={ev.id}>
                  <td>{ev.fecha}</td>
                  <td>{ev.materia}</td>
                  <td>
                    <span className={`pill ${ev.estado === "Finalizada" ? "baja" : "media"}`}>
                      {ev.estado}
                    </span>
                  </td>
                  <td className="t-right">
                    <button
                      className="btn sm"
                      onClick={() =>
                        navigate(ev.estado === "Finalizada" ? "/docente/historial" : "/docente/monitoreo")
                      }
                    >
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        {/* Estudiantes destacados */}
        <article className="card">
          <h2 className="card-title">Estudiantes destacados</h2>
          <ul className="list">
            {estudiantesDestacados.map((e) => (
              <li key={e.nombre} className="list-item">
                <div>
                  <div className="list-title">{e.nombre}</div>
                  <div className="muted">Reconocimiento: {e.logro}</div>
                </div>
                <span className="badge up">★</span>
              </li>
            ))}
          </ul>
        </article>

        {/* Alertas */}
        <article className="card">
          <h2 className="card-title">Alertas</h2>
          <ul className="bullets">
            {alertas.map((a, idx) => (
              <li key={idx}>
                <span className="dot" /> <strong>{a.estudiante}</strong> ({a.grupo}, {a.materia}): {a.motivo}
              </li>
            ))}
          </ul>
        </article>
      </section>
    </>
  );
}

// Barra de progreso simple
function Progress({ value = 0, small }) {
  return (
    <div
      className={`progress ${small ? "small" : ""}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div className="bar" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
