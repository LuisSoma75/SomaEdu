// src/pages/estudiante/ResolverEvaluacion.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function ResolverEvaluacion() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const sid = Number(sessionId);

  const auth = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("auth") || "{}"); }
    catch { return {}; }
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessionInfo, setSessionInfo] = useState(null);

  useEffect(() => {
    let abort = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        await fetch(`${API}/api/waitroom/${sid}/start`, { method: "POST" });
        if (!abort) setSessionInfo({ id_sesion: sid });
      } catch (e) {
        console.error(e);
        if (!abort) setError("No se pudo iniciar la evaluación.");
      } finally {
        if (!abort) setLoading(false);
      }
    })();
    return () => { abort = true; };
  }, [sid]);

  if (!auth?.idUsuario || String(auth?.role) !== "3") {
    return <div className="page">No autorizado.</div>;
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Resolver evaluación</h1>
        <div className="muted">Sesión #{sid}</div>
      </header>

      {loading && <div className="card">Preparando evaluación…</div>}
      {error && <div className="card error">{error}</div>}

      {!loading && !error && (
        <section className="card">
          <p>
            Esta es la pantalla base para resolver la evaluación.
            Aquí irán las preguntas, opciones y el temporizador.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <button className="btn" onClick={() => navigate(-1)}>Volver</button>
            <button className="btn primary" onClick={() => alert("TODO: Mostrar la primera pregunta")}>
              Comenzar
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
