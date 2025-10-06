// src/pages/estudiante/ResolverEvaluacion.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

// LOGS (pon en false si no quieres ver en consola)
const DBG  = true;
const log  = (...a) => DBG && console.log("[RESOLVER]", ...a);
const warn = (...a) => DBG && console.warn("[RESOLVER]", ...a);

export default function ResolverEvaluacion() {
  const { sessionId } = useParams();
  const sid = Number(sessionId);
  const navigate = useNavigate();

  // ====== auth ======
  const auth = useMemo(() => {
    try {
      const raw = localStorage.getItem("auth") || "{}";
      const parsed = JSON.parse(raw);
      log("auth:", parsed);
      return parsed;
    } catch {
      return {};
    }
  }, []);
  const idUsuario    = auth.id_usuario ?? auth.idUsuario ?? auth.userId ?? null;
  const carne        = auth.carne_estudiante ?? auth.carne ?? null;
  const estudianteId = idUsuario || carne;

  // ====== estado UI / sesión ======
  const [loading, setLoading]       = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState("");

  const [idMateria, setIdMateria]       = useState(null);
  const [idEvaluacion, setIdEvaluacion] = useState(null);
  const [valorStd, setValorStd]         = useState(0);
  const [numMax, setNumMax]             = useState(10);
  const [numActual, setNumActual]       = useState(0);
  const [finished, setFinished]         = useState(false);

  // Pregunta actual
  const [question, setQuestion] = useState(null);
  const [selected, setSelected] = useState(null);

  // Toma de tiempo por pregunta
  const startTickRef = useRef(Date.now());

  // -------- helpers --------
  const fetchJSON = useCallback(async (url, opts = {}) => {
    const r = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    let data = null;
    try { data = await r.json(); } catch {}
    log(opts.method || "GET", url, "->", r.status, data);
    if (!r.ok) throw new Error((data && (data.msg || data.message)) || `Error HTTP ${r.status}`);
    return data;
  }, []);

  // Normalización de la pregunta que viene del backend
  const normalizeQuestion = useCallback((qRaw) => {
    if (!qRaw) return null;
    const q = {
      id_pregunta: qRaw.id_pregunta ?? qRaw.id ?? qRaw.question_id,
      enunciado:   qRaw.enunciado   ?? qRaw.texto ?? qRaw.text ?? "Enunciado no disponible",
      opciones:    (qRaw.opciones   ?? qRaw.options ?? []).map((o) => ({
        id_opcion: o.id_opcion ?? o.id ?? o.value,
        texto:     o.texto     ?? o.label ?? o.descripcion ?? o.text ?? "Opción",
      })),
    };
    return q?.id_pregunta ? q : null;
  }, []);

  // 1) Obtener meta de sesión (id_materia y num_preg_max) desde el backend
  const fetchSessionMeta = useCallback(async () => {
    const endpoints = [
      `${API}/api/estudiante/evaluaciones?userId=${idUsuario ?? ""}`,
      `${API}/api/estudiante/evaluaciones?carne=${encodeURIComponent(carne ?? "")}`,
    ];
    for (const url of endpoints) {
      try {
        const j = await fetchJSON(url);
        const raw = j.items ?? j.data ?? j ?? [];
        const arr = Array.isArray(raw) ? raw : [];
        const match = arr.find((x) => {
          const ids = [x.id, x.id_sesion, x.sessionId, x.sesion_id].filter((v) => v != null);
          return ids.some((v) => Number(v) === sid);
        });
        if (match) {
          const materia = match.id_materia ?? match.materia_id ?? null;
          const nmax    = match.num_preg_max ?? match.num_preguntas ?? 10;
          if (materia != null) {
            log("meta detectada:", { id_materia: materia, num_preg_max: nmax });
            return { id_materia: Number(materia), num_preg_max: Number(nmax) };
          }
        }
      } catch (e) {
        warn("falló meta desde", url, e);
      }
    }
    throw new Error("No se encontró id_materia para la sesión.");
  }, [API, idUsuario, carne, sid, fetchJSON]);

  // 2) Iniciar sesión adaptativa y mostrar primera pregunta
  const startAndLoadFirst = useCallback(async () => {
    setLoading(true);
    setError("");
    setFinished(false);
    setQuestion(null);
    setSelected(null);
    setNumActual(0);
    try {
      // (A) marcar sala en curso (best-effort)
      try {
        await fetch(`${API}/api/waitroom/${sid}/start`, { method: "POST" });
      } catch (e) {
        warn("waitroom.start no crítico:", e.message);
      }

      // (B) meta
      const meta = await fetchSessionMeta();
      setIdMateria(meta.id_materia);
      setNumMax(meta.num_preg_max);

      // (C) iniciar adaptativo — PASAMOS id_sesion para evitar FK inválida
      const body = {
        carne_estudiante: String(estudianteId),
        id_materia: meta.id_materia,
        num_preg_max: meta.num_preg_max,
        id_sesion: Number.isFinite(sid) ? sid : undefined,
        sessionId: Number.isFinite(sid) ? sid : undefined, // compat
      };
      const startRes = await fetchJSON(`${API}/api/adaptative/session/start`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      const q = normalizeQuestion(startRes?.question || startRes?.data?.question || startRes?.data);
      if (!q) throw new Error("El servidor no devolvió una pregunta inicial.");

      setIdEvaluacion(Number(startRes.id_evaluacion));
      setValorStd(Number(startRes.valor_estandar ?? 0));
      setQuestion(q);
      setSelected(null);
      setNumActual(1);
      startTickRef.current = Date.now();
    } catch (e) {
      setError(e.message || "No se pudo iniciar la evaluación.");
    } finally {
      setLoading(false);
    }
  }, [API, sid, estudianteId, fetchJSON, fetchSessionMeta, normalizeQuestion]);

  // 3) Enviar respuesta y cargar siguiente
  const submitAnswer = useCallback(async () => {
    if (!question || selected == null || !idEvaluacion || !idMateria) return;
    setSubmitting(true);
    setError("");

    try {
      const elapsedSec = Math.max(0, Math.round((Date.now() - startTickRef.current) / 1000));

      const body = {
        id_pregunta: Number(question.id_pregunta),
        id_opcion: Number(selected),
        id_materia: Number(idMateria),
        valor_estandar_actual: Number(valorStd),
        tiempo_respuesta: elapsedSec,
      };

      const ans = await fetchJSON(`${API}/api/adaptative/session/${idEvaluacion}/answer`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      // ¿terminó?
      if (ans.finished) {
        setFinished(true);
        setQuestion(null);
        setSelected(null);
        try {
          await fetchJSON(`${API}/api/adaptative/session/${idEvaluacion}/end`, { method: "POST" });
        } catch (e) {
          warn("end no crítico:", e.message);
        }
        return;
      }

      // Siguiente
      const nextQ = normalizeQuestion(ans.question);
      if (!nextQ) {
        setFinished(true);
        setQuestion(null);
        setSelected(null);
        try {
          await fetchJSON(`${API}/api/adaptative/session/${idEvaluacion}/end`, { method: "POST" });
        } catch {}
        return;
      }

      setValorStd(Number(ans.valor_estandar ?? valorStd));
      setQuestion(nextQ);
      setSelected(null);
      setNumActual((n) => n + 1);
      startTickRef.current = Date.now();
    } catch (e) {
      setError(e.message || "No se pudo enviar la respuesta.");
    } finally {
      setSubmitting(false);
    }
  }, [API, fetchJSON, idEvaluacion, idMateria, question, selected, valorStd, normalizeQuestion]);

  // Atajo de teclado: Enter envía si hay selección
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === "Enter" && !loading && !submitting && question && selected != null) {
        submitAnswer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loading, submitting, question, selected, submitAnswer]);

  // --- UI: si no hay identidad, muestra aviso ---
  if (!estudianteId) {
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
      <header className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h1>Resolver evaluación</h1>
          <div className="muted">Sesión #{sid}</div>
        </div>
        {idMateria != null && (
          <div className="muted" title="Progreso">
            {numActual > 0 && !finished ? `Pregunta ${numActual}${numMax ? ` / ${numMax}` : ""}` : null}
          </div>
        )}
      </header>

      {loading && <div className="card">Preparando evaluación…</div>}
      {error && <div className="card error">{error}</div>}
      {finished && (
        <section className="card success">
          <h3 style={{ marginTop: 0 }}>¡Sesión finalizada!</h3>
          <p>Gracias por participar.</p>
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <button className="btn" onClick={() => navigate(-1)}>Volver</button>
          </div>
        </section>
      )}

      {!loading && !error && !finished && (
        <>
          {!question ? (
            <section className="card">
              <p>
                Presiona <strong>Comenzar</strong> para cargar la primera pregunta desde el módulo adaptativo.
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                <button className="btn" onClick={() => navigate(-1)}>Volver</button>
                <button className="btn primary" onClick={startAndLoadFirst}>Comenzar</button>
              </div>
            </section>
          ) : (
            <section className="card">
              <h3 style={{ marginTop: 0 }}>{question.enunciado}</h3>

              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {question.opciones.map((op) => (
                  <label
                    key={op.id_opcion}
                    className="radio-row"
                    style={{
                      padding: "10px 12px",
                      border: "1px solid #2b3345",
                      borderRadius: 8,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                    onClick={() => setSelected(op.id_opcion)}
                  >
                    <input
                      type="radio"
                      name="opt"
                      checked={String(selected) === String(op.id_opcion)}
                      onChange={() => setSelected(op.id_opcion)}
                    />
                    <span style={{ marginLeft: 8 }}>{op.texto}</span>
                  </label>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button className="btn" onClick={() => navigate(-1)} disabled={submitting}>Volver</button>
                <button
                  className="btn primary"
                  disabled={selected == null || submitting}
                  onClick={submitAnswer}
                  title={selected == null ? "Selecciona una opción" : "Enviar respuesta"}
                >
                  {submitting ? "Enviando…" : "Enviar"}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
