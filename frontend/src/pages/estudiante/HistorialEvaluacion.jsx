import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StudentSidebar from "../../components/StudentSidebar";
import "./HistorialEvaluacion.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function HistorialEvaluacion() {
  const navigate = useNavigate();

  // ---- auth ----
  const auth = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("auth") || "{}"); }
    catch { return {}; }
  }, []);
  const idUsuario = auth.id_usuario ?? auth.idUsuario ?? auth.userId ?? null;
  const carne = auth.carne_estudiante ?? auth.carne ?? null;

  // ---- estado ----
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState("");
  const [items, setItems] = useState([]);

  // ---- logout ----
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

  // ---- cargar historial ----
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setError("");

      const endpoints = [
        `${API}/api/estudiante/historial?userId=${idUsuario ?? ""}`,
        `${API}/api/estudiante/historial?carne=${encodeURIComponent(carne ?? "")}`,
        `${API}/api/evaluaciones/historial?userId=${idUsuario ?? ""}`,
      ].filter(Boolean);

      let ok = false;
      for (const url of endpoints) {
        try {
          const r = await fetch(url);
          if (!r.ok) continue;
          const j = await r.json();

          const raw = j.items ?? j.data ?? j ?? [];
          const norm = (Array.isArray(raw) ? raw : []).map((x, i) => ({
            id: x.id ?? x.id_intento ?? x.id_evaluacion ?? i + 1,
            titulo: x.titulo ?? x.nombre ?? "Evaluación",
            fecha: x.fecha ?? x.fecha_final ?? x.creado_en ?? null,
            estado: x.estado ?? (x.finalizado ? "finalizado" : "en_curso"),
            puntaje: x.puntaje ?? x.score ?? null,             // 0–100
            tiempo: x.tiempo ?? x.duracion ?? null,            // "00:12:35" o minutos
            intento: x.intento ?? x.attempt ?? 1,
          }));

          if (!cancel) setItems(norm);
          ok = true;
          break;
        } catch (_e) {}
      }

      // Fallback demo
      if (!ok && !cancel) {
        setItems([
          {
            id: 1,
            titulo: "Diagnóstico Álgebra",
            fecha: "2025-08-24 10:12",
            estado: "finalizado",
            puntaje: 84,
            tiempo: "00:18:22",
            intento: 1,
          },
          {
            id: 2,
            titulo: "Estadística básica",
            fecha: "2025-08-20 08:05",
            estado: "finalizado",
            puntaje: 90,
            tiempo: "00:22:10",
            intento: 1,
          },
        ]);
        setError("No se pudo cargar desde la API; mostrando ejemplo.");
      }

      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, [API, idUsuario, carne]);

  const list = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return items;
    return items.filter((x) =>
      [x.titulo, x.estado, x.fecha].filter(Boolean).some(s => String(s).toLowerCase().includes(q))
    );
  }, [items, filtro]);

  return (
    <div className="student-page">
      <StudentSidebar activeKey="historial" />

      <main className="main-content">
        <header className="edb-header">
          <div>
            <h1 className="edb-title">Historial de evaluaciones</h1>
            <p className="edb-sub">Intentos realizados por tu usuario.</p>
          </div>
          <div className="edb-quick" style={{ gap: 12, display: "flex", alignItems: "center" }}>
            <input
              className="inp"
              placeholder="Buscar por título, estado o fecha…"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
            <button className="btn ghost" onClick={() => navigate("/estudiante")}>Volver</button>
            <button className="btn danger" onClick={handleLogout}>Cerrar sesión</button>
          </div>
        </header>

        <section className="card">
          {loading ? (
            <div className="skeleton">Cargando historial…</div>
          ) : (
            <>
              {error && <div className="alert warning">{error}</div>}
              {list.length === 0 ? (
                <div className="empty">Aún no tienes evaluaciones registradas.</div>
              ) : (
                <table className="table hist-table">
                  <thead>
                    <tr>
                      <th>Título</th>
                      <th>Intento</th>
                      <th>Fecha</th>
                      <th>Estado</th>
                      <th>Puntaje</th>
                      <th>Tiempo</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((e) => (
                      <tr key={e.id}>
                        <td className="t-title">{e.titulo}</td>
                        <td>{e.intento}</td>
                        <td>{e.fecha ? String(e.fecha).slice(0,16).replace("T"," ") : "—"}</td>
                        <td><span className={`pill ${String(e.estado).toLowerCase()}`}>{e.estado}</span></td>
                        <td>{e.puntaje != null ? `${e.puntaje}/100` : "—"}</td>
                        <td>{e.tiempo ?? "—"}</td>
                        <td className="t-right">
                          <button className="btn sm">Ver detalle</button>
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
