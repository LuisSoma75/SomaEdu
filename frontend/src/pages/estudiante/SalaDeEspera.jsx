// frontend/src/pages/estudiante/SalaDeEspera.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./SalaDeEspera.css";

/** Base de la API (ajusta si tu backend corre en otro puerto) */
const API = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

/** Convierte cadena a id numérico válido (>0) o null */
function toSessionId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function SalaDeEspera() {
  // La URL puede venir como /estudiante/sala/:sidOrCode (PIN o id numérico)
  const { sidOrCode } = useParams();
  const navigate = useNavigate();

  // ⚠️ Reemplaza por tu fuente real (login/JWT)
  const estudiante = useMemo(() => {
    const raw = localStorage.getItem("somaedu_est");
    return raw ? JSON.parse(raw) : { id_estudiante: 1, nombre: "Estudiante" };
  }, []);

  // Si vino numérico, lo tomamos directo; si no, tratamos como PIN (texto)
  const [idSesion, setIdSesion] = useState(toSessionId(sidOrCode));
  const [sesionPIN, setSesionPIN] = useState(
    toSessionId(sidOrCode) ? null : String(sidOrCode || "").toUpperCase()
  );

  const [counts, setCounts] = useState({
    en_espera: 0,
    listos: 0,
    en_curso: 0,
    finalizados: 0,
    conectados: 0,
  });
  const [sesionEstado, setSesionEstado] = useState("programada");
  const [error, setError] = useState("");
  const joined = useRef(false);

  /* 1) Si vino un PIN, resolverlo a id_sesion */
  useEffect(() => {
    let cancel = false;

    async function resolveByPIN(pin) {
      if (!pin || toSessionId(pin)) return; // ya tenemos id
      try {
        // 1) Resolver por PIN
        let r = await fetch(`${API}/sesiones/by-pin/${encodeURIComponent(pin)}`);

        // 2) Fallback/alias (por compatibilidad)
        if (r.status === 404) {
          r = await fetch(`${API}/sesiones/codigo/${encodeURIComponent(pin)}`);
        }

        if (!r.ok) throw new Error("resolver-pin");
        const j = await r.json();
        const id = j?.item?.id_sesion ?? j?.id_sesion ?? null;
        if (!cancel) {
          if (toSessionId(id)) setIdSesion(Number(id));
          else setError("No se pudo resolver el PIN a un id válido.");
        }
      } catch {
        if (!cancel) setError("No se pudo resolver el PIN de sesión.");
      }
    }

    if (!idSesion && sesionPIN) resolveByPIN(sesionPIN);
    return () => {
      cancel = true;
    };
  }, [API, idSesion, sesionPIN]);

  /* 2) JOIN una vez que tengamos idSesion */
  useEffect(() => {
    if (!idSesion) return;
    const run = async () => {
      setError("");
      try {
        const r = await fetch(`${API}/waitroom/${idSesion}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_estudiante: estudiante.id_estudiante }),
        });
        const j = await r.json();
        if (r.ok) {
          joined.current = true;
        } else {
          setError(j?.error || "Error al entrar a la sala");
        }
      } catch {
        setError("No se pudo comunicar con el servidor (join).");
      }
    };
    run();
  }, [API, idSesion, estudiante.id_estudiante]);

  /* 3) PING cada 20 s */
  useEffect(() => {
    if (!joined.current || !idSesion) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${API}/waitroom/${idSesion}/ping`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_estudiante: estudiante.id_estudiante }),
        });
        const j = await r.json();
        if (r.ok && j.sesion_estado) setSesionEstado(j.sesion_estado);
      } catch {
        // silencioso; el siguiente ping reintenta
      }
    }, 20000);
    return () => clearInterval(t);
  }, [API, idSesion, estudiante.id_estudiante]);

  /* 4) METRICS cada 5 s + redirección si la sesión inicia */
  useEffect(() => {
    if (!idSesion) return;
    let cancel = false;

    const load = async () => {
      try {
        const r = await fetch(`${API}/waitroom/${idSesion}/metrics`);
        const j = await r.json();
        if (!cancel && r.ok) {
          setCounts(j.counts || j.participantes || counts);
          const estado = j.sesion_estado || j.estado || sesionEstado;
          setSesionEstado(estado);
          // Si usan 'activa' en lugar de 'iniciada', cubrimos ambos
          if (estado === "iniciada" || estado === "activa") {
            navigate(`/estudiante/evaluacion/${idSesion}`, { replace: true });
          }
        }
      } catch {
        // ignorar; reintenta en el siguiente ciclo
      }
    };

    load();
    const t = setInterval(load, 5000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API, idSesion, navigate]);

  return (
    <div className="waitroom">
      <div className="waitroom__container">
        <header className="waitroom__head">
          <h1 className="waitroom__title">Sala de espera</h1>
          <div className="waitroom__sessionlabel">
            <small>PIN / id</small>
            <b>
              {idSesion
                ? `#${idSesion}`
                : sesionPIN
                ? sesionPIN
                : "—"}
            </b>
          </div>
        </header>

        {!!error && (
          <div className="card" style={{ marginTop: 16, borderColor: "rgba(244,63,94,.4)", color: "#fecaca" }}>
            {error}
          </div>
        )}

        <div className="waitroom__grid">
          {/* Panel principal */}
          <div className="card">
            <p className="muted">
              La evaluación iniciará cuando el docente lo indique. Mantén esta ventana abierta.
            </p>

            <div className="mt-12">
              <span
                className={`badge ${
                  sesionEstado === "iniciada" || sesionEstado === "activa"
                    ? "badge--ok"
                    : sesionEstado === "finalizada"
                    ? "badge--end"
                    : "badge--warn"
                }`}
                title="Estado de la sesión"
              >
                <span className="badge__dot" />
                {sesionEstado}
              </span>
              <span className="muted" style={{ marginLeft: 12, fontSize: 13 }}>
                Estado de la sesión
              </span>
            </div>

            <div className="stats mt-12">
              <div className="stat">
                <span className="stat__label">En espera</span>
                <span className="stat__value">{counts.en_espera ?? 0}</span>
              </div>
              <div className="stat">
                <span className="stat__label">Listos</span>
                <span className="stat__value">{counts.listos ?? 0}</span>
              </div>
              <div className="stat">
                <span className="stat__label">En curso</span>
                <span className="stat__value">{counts.en_curso ?? 0}</span>
              </div>
              <div className="stat">
                <span className="stat__label">Finalizados</span>
                <span className="stat__value">{counts.finalizados ?? 0}</span>
              </div>
              <div className="stat">
                <span className="stat__label">Conectados</span>
                <span className="stat__value">{counts.conectados ?? 0}</span>
              </div>
            </div>

            <div className="info mt-20">
              <p>
                Estudiante:{" "}
                <strong style={{ color: "var(--text)" }}>
                  {estudiante?.nombre || "—"}
                </strong>
              </p>
              <p>Si cierras esta ventana podrías salir de la sala de espera.</p>
            </div>
          </div>

          {/* Panel derecho */}
          <div className="card">
            <h3 className="section-title">Recomendaciones</h3>
            <ul className="list">
              <li>Verifica tu conexión a internet.</li>
              <li>No recargues la página salvo indicación del docente.</li>
              <li>Permite notificaciones si se solicitan.</li>
            </ul>

            <div className="hr">
              <small className="muted">
                Conteos cada <b style={{ color: "var(--text)" }}>5 s</b>. Tu presencia se mantiene con un ping cada{" "}
                <b style={{ color: "var(--text)" }}>20 s</b>.
              </small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
