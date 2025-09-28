// src/pages/estudiante/EstudianteDashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StudentSidebar from "../../components/StudentSidebar";
import "./EstudianteDashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function EstudianteDashboard() {
  const navigate = useNavigate();

  // ---------- Auth local ----------
  const auth = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("auth") || "{}"); }
    catch { return {}; }
  }, []);

  // IDs posibles en tu auth
  const idEstudianteAuth =
    auth.idEstudiante ??
    auth.estudiante?.id_estudiante ??
    auth.id_estudiante ??
    null;

  const idUsuario =
    auth.id_usuario ??
    auth.idUsuario ??
    auth.userId ??
    null;

  // ---------- Header (desde BD) ----------
  const [perfil, setPerfil] = useState({
    nombre: auth.nombre || auth.name || "Estudiante",
    grado: null,
    seccion: null,
  });
  const [loadingPerfil, setLoadingPerfil] = useState(true);

  useEffect(() => {
    if (!idEstudianteAuth && !idUsuario) { setLoadingPerfil(false); return; }
    const ac = new AbortController();

    (async () => {
      try {
        const url = idEstudianteAuth
          ? `${API}/api/estudiantes/${idEstudianteAuth}/resumen`
          : `${API}/api/estudiantes/by-user/${idUsuario}/resumen`;

        const r = await fetch(url, { signal: ac.signal });
        const j = await r.json();

        if (j?.ok) {
          setPerfil(prev => ({
            nombre: j.data?.nombre_completo || prev.nombre || "Estudiante",
            grado: j.data?.grado || null,
            seccion: j.data?.seccion || null,
          }));
        }

        // Fallback de grado usando el id que venga en esta respuesta
        const idForFallback = idEstudianteAuth || j?.data?.carne_estudiante || null; // ya no imprescindible, pero no estorba
        if (!j?.data?.grado && idUsuario) {
          const r2 = await fetch(`${API}/api/estudiantes/by-user/${idUsuario}/grado-simple`, { signal: ac.signal });
          const j2 = await r2.json();
          if (j2?.ok && j2.data?.grado) {
            setPerfil(prev => ({ ...prev, grado: j2.data.grado }));
          }
        }
      } catch (e) {
        if (e.name !== "AbortError") console.error("Error cargando perfil estudiante:", e);
      } finally {
        setLoadingPerfil(false);
      }
    })();

    return () => ac.abort();
  }, [idEstudianteAuth, idUsuario]);

  // ---------- Logout ----------
  const handleLogout = () => {
    try {
      // borra objeto moderno
      localStorage.removeItem("auth");
      // borra claves legacy que se usaron antes
      localStorage.removeItem("nombre");
      localStorage.removeItem("rol");
      localStorage.removeItem("id_usuario");
      localStorage.removeItem("correo");
      localStorage.removeItem("token");
      localStorage.removeItem("idEstudiante");
      localStorage.removeItem("id_estudiante");
    } finally {
      navigate("/", { replace: true });
    }
  };

  // ---------- Resto de datos (mock) ----------
  const data = useMemo(() => ({
    mastery: 68,
    classAvg: 61,
    trend7d: +4,
    byArea: [
      { area: "Números", mastery: 72 },
      { area: "Álgebra", mastery: 59 },
      { area: "Geometría", mastery: 64 },
      { area: "Estadística", mastery: 70 },
    ],
    adaptive: { status: "en_curso", topic: "Ecuaciones lineales", estMin: 12 },
    recs: [
      { id: "r1", topic: "Proporciones", action: "Practicar", est: 8, note: "fallaste 3 ítems similares" },
      { id: "r2", topic: "Ángulos interiores", action: "Ver teoría", est: 6, note: "patrón de error conceptual" },
      { id: "r3", topic: "Mediana y moda", action: "Quiz rápido", est: 5, note: "repaso corto sugerido" },
    ],
    upcoming: [
      { id: "u1", title: "Tarea: Sistemas de ecuaciones", due: "2025-08-30 18:00", priority: "alta" },
      { id: "u2", title: "Evaluación adaptativa CNB", due: "2025-09-02 07:30", priority: "media" },
    ],
    grades: [
      { id: "g1", title: "Quiz Álgebra", score: 84, max: 100, date: "2025-08-24" },
      { id: "g2", title: "Proyecto Estadística", score: 90, max: 100, date: "2025-08-20" },
    ],
    attendance: { present: 18, total: 20 },
    notices: [
      { id: "n1", text: "Se publicó material de refuerzo de Álgebra.", date: "2025-08-27" },
      { id: "n2", text: "Recordatorio: traer calculadora el viernes.", date: "2025-08-26" },
    ],
  }), []);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "¡Buenos días!";
    if (h < 18) return "¡Buenas tardes!";
    return "¡Buenas noches!";
  }, []);

  const subHeader = useMemo(() => {
    if (loadingPerfil) return "Cargando grado y sección…";
    const parts = [];
    if (perfil.grado) parts.push(`Grado ${perfil.grado}`);
    if (perfil.seccion) parts.push(`Sección ${perfil.seccion}`);
    return parts.length ? parts.join(" • ") : "—";
  }, [perfil.grado, perfil.seccion, loadingPerfil]);

  return (
    <div className="student-page">
      <StudentSidebar />

      <main className="main-content">
        <header className="edb-header">
          <div>
            <h1 className="edb-title">
              {greeting} {perfil.nombre}
            </h1>
            <p className="edb-sub">{subHeader}</p>
          </div>
          <div className="edb-quick">
            <button className="btn primary">Reanudar evaluación</button>
            <button className="btn ghost">Ver calendario</button>
            <button className="btn ghost" onClick={handleLogout}>Cerrar sesión</button>
          </div>
        </header>

        <section className="grid">
          {/* Progreso general */}
          <article className="card span-2">
            <h2 className="card-title">Progreso general</h2>
            <div className="kpis">
              <div className="kpi">
                <div className="kpi-label">Dominio global</div>
                <div className="kpi-value">{data.mastery}%</div>
                <Progress value={data.mastery} />
              </div>
              <div className="kpi">
                <div className="kpi-label">Promedio del curso</div>
                <div className="kpi-value">{data.classAvg}%</div>
                <Progress value={data.classAvg} />
              </div>
              <div className="kpi trend">
                <div className="kpi-label">Tendencia 7d</div>
                <div className={`badge ${data.trend7d >= 0 ? "up" : "down"}`}>
                  {data.trend7d >= 0 ? `▲ +${data.trend7d}%` : `▼ ${data.trend7d}%`}
                </div>
              </div>
            </div>

            <div className="areas">
              {data.byArea.map(a => (
                <div key={a.area} className="area">
                  <div className="area-top">
                    <span className="area-name">{a.area}</span>
                    <span className="area-val">{a.mastery}%</span>
                  </div>
                  <Progress value={a.mastery} small />
                </div>
              ))}
            </div>
          </article>

          {/* Continuar adaptativa */}
          <article className="card">
            <h2 className="card-title">Continuar evaluación</h2>
            <p className="muted">Estado: <b>{data.adaptive.status}</b></p>
            <p className="muted">Tema: <b>{data.adaptive.topic}</b></p>
            <p className="muted">Tiempo estimado: <b>{data.adaptive.estMin} min</b></p>
            <div className="actions">
              <button className="btn primary">Continuar</button>
              <button className="btn">Reiniciar</button>
            </div>
          </article>

          {/* Recomendaciones */}
          <article className="card">
            <h2 className="card-title">Recomendaciones IA</h2>
            <ul className="list">
              {data.recs.map(r => (
                <li key={r.id} className="list-item">
                  <div>
                    <div className="list-title">{r.topic}</div>
                    <div className="muted">Sugerido: {r.action} • {r.est} min • {r.note}</div>
                  </div>
                  <button className="btn sm">Ir</button>
                </li>
              ))}
            </ul>
          </article>

          {/* Próximas actividades */}
          <article className="card span-2">
            <h2 className="card-title">Próximas actividades</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Entrega</th>
                  <th>Prioridad</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.upcoming.map(u => (
                  <tr key={u.id}>
                    <td>{u.title}</td>
                    <td>{u.due}</td>
                    <td><span className={`pill ${u.priority}`}>{u.priority}</span></td>
                    <td className="t-right"><button className="btn sm">Ver</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          {/* Desempeño reciente */}
          <article className="card">
            <h2 className="card-title">Desempeño reciente</h2>
            <ul className="list">
              {data.grades.map(g => (
                <li key={g.id} className="list-item">
                  <div>
                    <div className="list-title">{g.title}</div>
                    <div className="muted">{g.date} • {g.score}/{g.max}</div>
                  </div>
                  <div className="score">{g.score}</div>
                </li>
              ))}
            </ul>
          </article>

          {/* Asistencia */}
          <article className="card">
            <h2 className="card-title">Asistencia</h2>
            <p className="muted">
              {data.attendance.present} de {data.attendance.total} asistencias
            </p>
            <Progress value={Math.round((data.attendance.present / data.attendance.total) * 100)} />
          </article>

          {/* Notificaciones */}
          <article className="card">
            <h2 className="card-title">Notificaciones</h2>
            <ul className="bullets">
              {data.notices.map(n => (
                <li key={n.id}><span className="dot" /> {n.text} <span className="muted">• {n.date}</span></li>
              ))}
            </ul>
          </article>
        </section>
      </main>
    </div>
  );
}

// Componentes internos simples
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
