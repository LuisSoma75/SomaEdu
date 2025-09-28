// src/pages/docente/MonitoreoEvaluacion.jsx
import React, { useEffect, useMemo, useState } from "react";
import "./MonitoreoEvaluacion.css";
import { socket } from "../../services/socket";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function MonitoreoEvaluacion() {
  // ---------- Auth básico ----------
  const auth = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("auth") || "{}"); }
    catch { return {}; }
  }, []);
  const idDocente = auth.idDocente ?? auth.idUsuario ?? 0;

  // ---------- Estado ----------
  const [loadingEvals, setLoadingEvals] = useState(true);
  const [evaluaciones, setEvaluaciones] = useState([]);
  const [filterText, setFilterText] = useState("");
  const [selectedSesionId, setSelectedSesionId] = useState(null);

  const [meta, setMeta] = useState({
    nombre: null,
    estado: "programada",
    pin: null,
    grado_nombre: null,
    materia_nombre: null,
  });

  const [counts, setCounts] = useState({
    en_espera: 0,
    listo: 0,
    en_curso: 0,
    finalizado: 0,
  });

  const [starting, setStarting] = useState(false);
  const [busyState, setBusyState] = useState(false);
  const [loadingTable, setLoadingTable] = useState(false);
  const [participantes, setParticipantes] = useState([]);

  // ---------- REST ----------
  const fetchEvaluaciones = async () => {
    const estados = encodeURIComponent("programada,en_espera,activa,finalizada");
    const r = await fetch(`${API}/api/docente/evaluaciones?estado=${estados}`);
    const j = await r.json();
    if (Array.isArray(j)) return j;
    if (j?.ok && Array.isArray(j.data)) return j.data;
    if (j?.ok && Array.isArray(j.items)) return j.items;
    return [];
  };

  const fetchState = async (sid) => {
    const r = await fetch(`${API}/api/waitroom/${sid}/state`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "state_failed");
    return j;
  };

  const fetchParticipants = async (sid) => {
    const r = await fetch(`${API}/api/waitroom/${sid}/participants`);
    if (r.status === 404) return [];
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "participants_failed");
    return j.items || [];
  };

  const startSesion = async (sid) => {
    const r = await fetch(`${API}/api/waitroom/${sid}/start`, { method: "POST" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "start_failed");
  };

  // ---------- Cargar evaluaciones ----------
  useEffect(() => {
    (async () => {
      try {
        setLoadingEvals(true);
        const list = await fetchEvaluaciones();
        const norm = list.map(e => ({
          id_sesion: e.id_sesion ?? e.id ?? null,
          nombre: e.nombre ?? (e.id_sesion ? `Sesión ${e.id_sesion}` : "Sesión"),
          estado: e.estado ?? "programada",
          pin: e.pin ?? null,
          grado_nombre: e.grado_nombre ?? null,
          materia_nombre: e.materia_nombre ?? null,
        })).filter(e => e.id_sesion);

        setEvaluaciones(norm);

        const prefer =
          norm.find(e => e.estado === "en_espera") ||
          norm.find(e => e.estado === "activa") ||
          norm.find(e => e.estado === "programada") ||
          norm[0];

        if (prefer?.id_sesion) {
          setSelectedSesionId(prefer.id_sesion);
          setMeta({
            nombre: prefer.nombre,
            estado: prefer.estado,
            pin: prefer.pin,
            grado_nombre: prefer.grado_nombre,
            materia_nombre: prefer.materia_nombre,
          });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingEvals(false);
      }
    })();
  }, []);

  // ---------- Cargar estado de la sesión ----------
  useEffect(() => {
    if (!selectedSesionId) return;

    socket.emit("join-session", {
      sessionId: Number(selectedSesionId),
      userId: idDocente,
      role: "docente",
    });

    (async () => {
      try {
        setBusyState(true);
        const s = await fetchState(selectedSesionId);
        setCounts(s.participantes || {});
        setMeta(prev => ({ ...prev, estado: s.estado }));
      } catch (e) {
        console.error(e);
      } finally {
        setBusyState(false);
      }

      try {
        setLoadingTable(true);
        const ps = await fetchParticipants(selectedSesionId);
        setParticipantes(ps);
      } catch (e) {
        // opcional
      } finally {
        setLoadingTable(false);
      }

      const info = evaluaciones.find(x => x.id_sesion === selectedSesionId);
      if (info) {
        setMeta(prev => ({
          ...prev,
          nombre: info.nombre,
          pin: info.pin ?? prev.pin,
          grado_nombre: info.grado_nombre ?? prev.grado_nombre,
          materia_nombre: info.materia_nombre ?? prev.materia_nombre,
        }));
      }
    })();
  }, [selectedSesionId, idDocente]);

  // ---------- RT ----------
  useEffect(() => {
    const onState = (data) => {
      const sid = Number(data?.id_sesion ?? data?.sessionId);
      if (sid !== Number(selectedSesionId)) return;
      setCounts(data.participantes || {});
      setMeta(prev => ({ ...prev, estado: data.estado }));
    };

    const onStarted = (data) => {
      const sid = Number(data?.id_sesion ?? data?.sessionId);
      if (sid !== Number(selectedSesionId)) return;
      setMeta(prev => ({ ...prev, estado: "activa" }));
    };

    socket.on("waitroom:state", onState);
    socket.on("waitroom:started", onStarted);
    return () => {
      socket.off("waitroom:state", onState);
      socket.off("waitroom:started", onStarted);
    };
  }, [selectedSesionId]);

  // ---------- Filtro ----------
  const filtered = useMemo(() => {
    const t = filterText.trim().toLowerCase();
    if (!t) return evaluaciones;
    return evaluaciones.filter(e =>
      (e.nombre ?? "").toLowerCase().includes(t) ||
      String(e.id_sesion).includes(t) ||
      (e.estado ?? "").toLowerCase().includes(t)
    );
  }, [filterText, evaluaciones]);

  // ---------- Acciones ----------
  const handleStart = async () => {
    if (!selectedSesionId) return;
    try {
      setStarting(true);
      await startSesion(selectedSesionId);
      socket.emit("start-session", { sessionId: Number(selectedSesionId), userId: idDocente, role: "docente" });
    } catch (e) {
      console.error(e);
      alert("No se pudo iniciar la evaluación seleccionada.");
    } finally {
      setStarting(false);
    }
  };

  const copyPin = async () => {
    if (!meta.pin) return;
    try {
      await navigator.clipboard.writeText(String(meta.pin));
      toastMini("PIN copiado");
    } catch {
      toastMini("No se pudo copiar");
    }
  };

  // ---------- Render ----------
  return (
    <div className="me-wrap">
      <div className="me-header">
        <h1>Monitoreo en tiempo real</h1>
        <p>Gestiona la sala de espera y da inicio cuando todos estén listos.</p>
      </div>

      {/* Toolbar */}
      <section className="me-card me-toolbar">
        <div className="me-toolbar-grid">
          <div className="me-toolbar-left">
            <label className="me-label">Evaluación</label>
            <div className="me-search-select">
              <input
                type="text"
                placeholder="Buscar por nombre, ID o estado…"
                className="me-input"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
              <select
                value={selectedSesionId || ""}
                onChange={(e) => setSelectedSesionId(Number(e.target.value))}
                className="me-select"
              >
                <option value="" disabled>{loadingEvals ? "Cargando…" : "Selecciona una evaluación…"}</option>
                {filtered.map(ev => (
                  <option key={ev.id_sesion} value={ev.id_sesion}>
                    {ev.nombre} — {ev.estado}
                  </option>
                ))}
              </select>
            </div>
            {!loadingEvals && !evaluaciones.length && (
              <div className="me-hint">No hay evaluaciones. Crea una desde “Evaluaciones”.</div>
            )}
          </div>

          <div className="me-toolbar-right">
            <button
              onClick={handleStart}
              disabled={!selectedSesionId || starting || meta.estado === "activa"}
              className="me-btn me-btn-primary"
              title={!selectedSesionId ? "Selecciona una evaluación" : ""}
            >
              {meta.estado === "activa" ? "Sesión activa" : (starting ? "Iniciando…" : "Iniciar evaluación")}
            </button>
            <button
              onClick={() => window.alert("Próximamente: historial")}
              className="me-btn me-btn-ghost"
            >
              Ver historial
            </button>
          </div>
        </div>

        {/* Metadatos */}
        <div className="me-meta">
          <span className="me-meta-badge">{meta.nombre ?? "—"}</span>
          <StatusPill estado={meta.estado} />
          {meta.pin && (
            <button className="me-meta-badge me-btn-pin" onClick={copyPin} title="Copiar PIN">
              PIN: <b>{meta.pin}</b>
            </button>
          )}
          {(meta.grado_nombre || meta.materia_nombre) && (
            <span className="me-meta-badge">
              {meta.grado_nombre ? `${meta.grado_nombre}` : ""}{meta.grado_nombre && meta.materia_nombre ? " • " : ""}{meta.materia_nombre ? `${meta.materia_nombre}` : ""}
            </span>
          )}
          {busyState && <span className="me-meta-loading">Actualizando estado…</span>}
        </div>

        {/* Tarjetas */}
        <div className="me-stats">
          <StatCard label="En espera" value={counts.en_espera} />
          <StatCard label="Listos" value={counts.listo} />
          <StatCard label="En curso" value={counts.en_curso} />
          <StatCard label="Finalizados" value={counts.finalizado} />
        </div>
      </section>

      {/* Tabla */}
      <section className="me-card">
        <div className="me-table-head">
          <span>Estudiantes conectados</span>
          {loadingTable && <span className="me-muted">Cargando…</span>}
        </div>

        <div className="me-table-wrap">
          <table className="me-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Estado</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {loadingTable ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : participantes?.length ? (
                participantes.map((p) => (
                  <tr key={`${p.id_estudiante}-${p.estado}-${p.joined_at}`}>
                    <td>{p.nombre ?? `Estudiante ${p.id_estudiante}`}</td>
                    <td><StatusPill estado={p.estado} /></td>
                    <td>
                      <button className="me-btn me-btn-ghost sm">Ver detalle</button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="3" className="me-empty">
                    <EmptyIcon />
                    <span>Aún no hay estudiantes conectados. Pide que ingresen al enlace de la evaluación.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ====== Subcomponentes ====== */

function StatCard({ label, value }) {
  return (
    <div className="me-stat">
      <div className="title">{label}</div>
      <div className="value">{value ?? 0}</div>
    </div>
  );
}

function StatusPill({ estado }) {
  const cl = {
    programada: "rose",
    en_espera: "blue",
    listo: "amber",
    activa: "indigo",
    en_curso: "indigo",
    finalizada: "emerald",
    finalizado: "emerald",
    cancelada: "gray",
    retirado: "red",
  }[estado] || "default";
  const text = (estado ?? "—").replace("_", " ");
  return <span className={`me-pill ${cl}`}>{text}</span>;
}

function SkeletonRow() {
  return (
    <tr>
      <td><div className="sk w-40" /></td>
      <td><div className="sk w-24 h6" /></td>
      <td><div className="sk w-24 h8" /></td>
    </tr>
  );
}

function EmptyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" className="me-empty-icon">
      <path fill="currentColor" d="M19 3H5a2 2 0 0 0-2 2v10a4 4 0 0 0 4 4h1v2h8v-2h1a4 4 0 0 0 4-4V5a2 2 0 0 0-2-2M5 5h14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zm4 4h6v2H9z"/>
    </svg>
  );
}

function toastMini(texto = "") {
  const n = document.createElement("div");
  n.textContent = texto;
  n.className = "me-toast";
  document.body.appendChild(n);
  setTimeout(() => { n.style.opacity = "0"; }, 1200);
  setTimeout(() => n.remove(), 1600);
}
