// src/pages/estudiante/ResolverEvaluacion.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

// Toggle de logs locales de esta vista
const DBG = true;
const log = (...a) => DBG && console.log("[RESOLVER]", ...a);
const warn = (...a) => DBG && console.warn("[RESOLVER]", ...a);

export default function ResolverEvaluacion() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const sid = Number(sessionId);

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
  const role = auth.role ?? auth.rol ?? null;
  log("auth.normalizado ->", { idUsuario, carne, role });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessionInfo, setSessionInfo] = useState(null);

  useEffect(() => {
    log("MOUNT ResolverEvaluacion, sid =", sid);

    let abort = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        // 1) Opcional/seguro: marca en curso si aún figuraba "en espera".
        const url = `${API}/api/waitroom/${sid}/start`;
        const r = await fetch(url, { method: "POST" });
        log("POST start ->", url, r.status);

        // 2) Si tienes endpoint de detalle de sesión, úsalo aquí:
        // const det = await fetch(`${API}/api/sesiones/${sid}`);
        // const js = await det.json();
        // if (!abort) setSessionInfo(js);
        if (!abort) setSessionInfo({ id_sesion: sid });
      } catch (e) {
        warn("Error iniciando evaluación:", e);
        if (!abort) setError("No se pudo iniciar la evaluación.");
      } finally {
        if (!abort) setLoading(false);
      }
    })();

    return () => { abort = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  const handleComenzar = () => {
    log("Comenzar click -> debería cargar primera pregunta (TODO)");
    alert("TODO: cargar la primera pregunta desde tu módulo adaptativo.");
    // Ejemplo de siguientes pasos:
    // - POST `${API}/api/adaptative/session/${sid}/start` (si aplica)
    // - GET `${API}/api/adaptative/session/${sid}/next`
    // - Renderizar pregunta y opciones, y luego POST /answer
  };

  // Si entras sin auth, el guard del router debería frenarte.
  // Aún así, dejamos un mensaje visual por si alguien llega directo por URL.
  if (!idUsuario && !carne) {
    return (
      <div className="page">
        <header className="page-header">
          <h1>Resolver evaluación</h1>
          <div className="muted">Sesión #{sid}</div>
        </header>
        <div className="card error">
          No hay sesión de estudiante válida. Inicia sesión nuevamente.
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => navigate("/")}>Ir a Login</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" data-testid="resolver-page">
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
            <button
              className="btn primary"
              data-testid="btn-comenzar"
              onClick={handleComenzar}
            >
              Comenzar
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
