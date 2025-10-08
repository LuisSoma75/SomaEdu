// src/pages/estudiante/ResolverEvaluacion.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import "./ResolverEvaluacion.css";

/* ================= Base de URL ================= */
const API = (import.meta.env.VITE_API_URL || "http://localhost:3001").replace(/\/+$/,"");

/* =============== logs locales =============== */
const DBG  = true;
const log  = (...a) => DBG && console.log("[RESOLVER]", ...a);
const warn = (...a) => DBG && console.warn("[RESOLVER]", ...a);

export default function ResolverEvaluacion() {
  const { sessionId } = useParams();
  const sid = Number(sessionId);
  const navigate = useNavigate();

  /* =============== auth =============== */
  const auth = useMemo(() => {
    try {
      const raw = localStorage.getItem("auth") || "{}";
      const parsed = JSON.parse(raw);
      return parsed || {};
    } catch { return {}; }
  }, []);
  const idUsuario    = auth.id_usuario ?? auth.idUsuario ?? auth.userId ?? null;
  const carne        = auth.carne_estudiante ?? auth.carne ?? null;
  const estudianteId = idUsuario || carne;

  /* =============== estado =============== */
  const [loading, setLoading]       = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState("");

  const [idMateria, setIdMateria]       = useState(null);
  const [idEvaluacion, setIdEvaluacion] = useState(null);
  const [valorStd, setValorStd]         = useState(0);
  const [numMax, setNumMax]             = useState(10);
  const [numActual, setNumActual]       = useState(0);
  const [finished, setFinished]         = useState(false);

  const [areaScores, setAreaScores]     = useState(null); // {areas:[...], summary?:{...}}

  const [question, setQuestion] = useState(null);
  const [selected, setSelected] = useState(null);

  // feedback correcto/incorrecto
  const [showFeedback, setShowFeedback] = useState(false);
  const [lastFeedback, setLastFeedback] = useState({ correcta: null, selectedId: null });

  // tiempo por pregunta
  const startTickRef = useRef(Date.now());

  /* =============== helpers http =============== */
  const fetchJSON = useCallback(async (url, opts = {}) => {
    const r = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    let data = null;
    try { data = await r.json(); } catch {}
    log(opts.method || "GET", url, "->", r.status, data);
    if (!r.ok) throw new Error((data && (data.msg || data.message || data.error)) || `HTTP ${r.status}`);
    return data;
  }, []);

  /* =============== normalización de pregunta =============== */
  const normalizeQuestion = useCallback((qRaw) => {
    if (!qRaw) return null;
    const q = {
      id_pregunta: qRaw.id_pregunta ?? qRaw.id ?? qRaw.question_id,
      enunciado:   qRaw.enunciado   ?? qRaw.texto ?? qRaw.text ?? "Enunciado no disponible",
      opciones:    (qRaw.opciones   ?? qRaw.options ?? []).map((o) => ({
        id_opcion: o.id_opcion ?? o.id ?? o.value,
        texto:     o.texto     ?? o.label ?? o.descripcion ?? o.text ?? "Opción",
      })),
      id_area: qRaw.id_area ?? null,
      area:    qRaw.area ?? null,
      valor:   Number(qRaw.valor ?? 0), // ← único valor que mostramos
    };
    return q?.id_pregunta ? q : null;
  }, []);

  /* =============== meta de sesión (materia, num preguntas) =============== */
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
            return { id_materia: Number(materia), num_preg_max: Number(nmax) };
          }
        }
      } catch (e) {
        warn("falló meta desde", url, e);
      }
    }
    throw new Error("No se encontró id_materia para la sesión.");
  }, [API, idUsuario, carne, sid, fetchJSON]);

  /* =============== iniciar + primera pregunta =============== */
  const startAndLoadFirst = useCallback(async () => {
    setLoading(true);
    setError("");
    setFinished(false);
    setAreaScores(null);
    setQuestion(null);
    setSelected(null);
    setNumActual(0);
    setShowFeedback(false);
    setLastFeedback({ correcta: null, selectedId: null });

    try {
      try { await fetch(`${API}/api/waitroom/${sid}/start`, { method: "POST" }); } catch {}

      const meta = await fetchSessionMeta();
      setIdMateria(meta.id_materia);
      setNumMax(meta.num_preg_max);

      const body = {
        carne_estudiante: String(estudianteId),
        id_materia: meta.id_materia,
        num_preg_max: meta.num_preg_max,
        id_sesion: Number.isFinite(sid) ? sid : undefined,
        sessionId: Number.isFinite(sid) ? sid : undefined,
      };
      const startRes = await fetchJSON(`${API}/api/adaptative/session/start`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      const q = normalizeQuestion(startRes?.question || startRes?.data?.question || startRes?.data);
      if (!q) throw new Error("El servidor no devolvió una pregunta inicial.");

      setIdEvaluacion(Number(startRes.id_evaluacion));
      setValorStd(Number(startRes.valor_estandar ?? 0));
      if (Number.isFinite(Number(startRes.num_preg_max))) {
        setNumMax(Number(startRes.num_preg_max));
      }

      setQuestion(q);
      setSelected(null);
      setNumActual(1);
      startTickRef.current = Date.now();
    } catch (e) {
      setError(e.message || "No se pudo iniciar la evaluación.");
    } finally {
      setLoading(false);
    }
  }, [API, sid, estudianteId, fetchSessionMeta, fetchJSON, normalizeQuestion]);

  /* =============== traer resultados por área (después de terminar) =============== */
  const fetchAreaScores = useCallback(async (evaluacionId) => {
    const urls = [
      `${API}/api/adaptative/session/${evaluacionId}/areas`,
      `${API}/backend/api/adaptative/session/${evaluacionId}/areas`,
      `${API}/api/estudiante/evaluaciones/${sid}/areas?evaluacionId=${evaluacionId}`,
    ];
    for (const u of urls) {
      try {
        const j = await fetchJSON(u);
        if (j && (j.areas || j.items)) {
          const payload = j.areas ? j : { areas: j.items, summary: j.summary, total: j.total };
          return payload;
        }
      } catch (e) {}
    }
    return null;
  }, [API, sid, fetchJSON]);

  /* =============== enviar respuesta + siguiente (con highlight) =============== */
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

      // feedback visual antes de cambiar
      setLastFeedback({ correcta: !!ans.correcta, selectedId: Number(selected) });
      setShowFeedback(true);

      // terminó?
      if (ans.finished) {
        await new Promise(r => setTimeout(r, 450));
        setShowFeedback(false);

        setFinished(true);
        setQuestion(null);
        setSelected(null);

        if (ans.areas && Array.isArray(ans.areas) && ans.areas.length) {
          setAreaScores({ areas: ans.areas, summary: ans.summary ?? null });
        } else {
          try {
            const areas = await fetchAreaScores(idEvaluacion);
            if (areas) setAreaScores(areas);
          } catch (e) { warn("area-scores:", e.message); }
        }

        try { await fetchJSON(`${API}/api/adaptative/session/${idEvaluacion}/end`, { method: "POST" }); } catch {}
        return;
      }

      // siguiente
      const nextQ = normalizeQuestion(ans.question);
      if (!nextQ) {
        await new Promise(r => setTimeout(r, 450));
        setShowFeedback(false);

        setFinished(true);
        setQuestion(null);
        setSelected(null);

        if (ans.areas && Array.isArray(ans.areas) && ans.areas.length) {
          setAreaScores({ areas: ans.areas, summary: ans.summary ?? null });
        } else {
          try {
            const areas = await fetchAreaScores(idEvaluacion);
            if (areas) setAreaScores(areas);
          } catch {}
        }

        try { await fetchJSON(`${API}/api/adaptative/session/${idEvaluacion}/end`, { method: "POST" }); } catch {}
        return;
      }

      await new Promise(r => setTimeout(r, 450));
      setShowFeedback(false);

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
  }, [API, fetchJSON, idEvaluacion, idMateria, question, selected, valorStd, normalizeQuestion, fetchAreaScores]);

  /* =============== atajo ENTER =============== */
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === "Enter" && !loading && !submitting && question && selected != null) {
        submitAnswer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loading, submitting, question, selected, submitAnswer]);

  /* =============== helpers UI =============== */

  const computeSummaryFromAreas = (areas) => {
    if (!areas || !areas.length) return null;
    const total = areas.reduce((a,x)=>a + Number(x.total||0), 0);
    const correctas = areas.reduce((a,x)=>a + Number(x.correctas||0), 0);
    const pct_global = total>0 ? Number(((correctas/total)*100).toFixed(1)) : 0;
    const rit_prom = total>0 ? Number((areas.reduce((a,x)=>a + (Number(x.rit||0)*Number(x.total||0)),0)/total).toFixed(1)) : 0;
    return { pct_global, rit_prom, total, correctas };
  };

  /* =============== UI =============== */

  if (!estudianteId) {
    return (
      <div id="resolver-root" className="resolver-ctx" data-testid="resolver-page">
        <section className="card error">
          <h3 style={{marginTop:0}}>Sesión inválida</h3>
          <p>No hay sesión de estudiante válida. Inicia sesión nuevamente.</p>
          <div className="resolver-actions" style={{marginTop:12}}>
            <button className="btn" onClick={() => navigate("/")}>Ir a Login</button>
          </div>
        </section>
      </div>
    );
  }

  const styleOK = { borderColor: "#16a34a", boxShadow: "0 0 0 2px #16a34a66" };
  const styleBAD = { borderColor: "#dc2626", boxShadow: "0 0 0 2px #dc262666" };

  return (
    <div id="resolver-root" className="resolver-ctx" data-testid="resolver-page">
      <section className="card">
        {/* Header */}
        <div className="header">
          <div>
            <div className="title">Resolver evaluación</div>
            <div className="muted">Sesión #{sid}</div>
          </div>
          {idMateria != null && !finished && (
            <div className="chip" title="Progreso">
              {numActual > 0 ? `Pregunta ${numActual}${numMax ? ` / ${numMax}` : ""}` : "Preparando…"}
            </div>
          )}
        </div>

        {/* Barra progreso */}
        {!finished && (
          <div
            className="progress"
            style={{ "--progress": `${Math.min(100, (numActual / (numMax || 1)) * 100)}%` }}
          >
            <div className="progressBar" />
          </div>
        )}

        {/* Mensajes */}
        {loading && <div className="panel">Preparando evaluación…</div>}
        {error && <div className="panel alertError">{error}</div>}

        {/* Contenido: terminado */}
        {finished && (
          <>
            <div className="panel alertSuccess" style={{marginBottom:12}}>
              <strong>¡Sesión finalizada!</strong> Gracias por participar.
            </div>

            {/* Resumen general */}
            {(() => {
              const sumServer = areaScores?.summary || null;
              const sumLocal  = computeSummaryFromAreas(areaScores?.areas || []);
              const sum = sumServer || sumLocal;
              if (!sum) return null;
              const promedio10 = Number(((sum.pct_global ?? 0) / 10).toFixed(1));
              return (
                <div className="panel" style={{marginBottom:12}}>
                  <span>Promedio general (0–10): <strong>{promedio10}</strong></span>
                  <span style={{marginLeft:16}}>% Acierto global: <strong>{sum.pct_global?.toFixed?.(1) ?? sum.pct_global}%</strong></span>
                  <span style={{marginLeft:16}}>RIT promedio: <strong>{sum.rit_prom}</strong></span>
                </div>
              );
            })()}

            {/* Tabla de áreas */}
            {areaScores?.areas?.length ? (
              <div style={{marginTop:12}}>
                <h3 style={{margin:"8px 0 10px"}}>Resultados por área</h3>
                <table className="resolver-table">
                  <thead>
                    <tr>
                      <th>Área</th>
                      <th>Correctas</th>
                      <th>% Acierto</th>
                      <th>RIT</th>
                      <th>Nivel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {areaScores.areas.map((a, i) => {
                      const nombre = a.area ?? a.nombre ?? "—";
                      const total = Number(a.total ?? a.n ?? 0);
                      const correctas = Number(a.correctas ?? 0);
                      const pct = typeof a.pct === "number"
                        ? a.pct
                        : (total > 0 ? (correctas / total) * 100 : 0);
                      const rit = Number(a.rit ?? 0);
                      const nivel = a.level || a.nivel || "—";
                      return (
                        <tr key={i}>
                          <td className="cap">{nombre}</td>
                          <td className="bold">{correctas} / {total}</td>
                          <td>{pct.toFixed(1)}%</td>
                          <td className="bold">{isFinite(rit) ? rit.toFixed(1) : "—"}</td>
                          <td>
                            <span className={`level-pill ${String(nivel).toLowerCase().replaceAll(" ", "_")}`}>
                              {nivel}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="panel" style={{marginTop:10}}>
                No se encontraron respuestas agrupables por área en esta evaluación.
              </div>
            )}

            <div className="resolver-actions" style={{marginTop:16}}>
              <button className="btn" onClick={() => navigate(-1)}>Volver</button>
            </div>
          </>
        )}

        {/* Contenido: en curso */}
        {!loading && !error && !finished && (
          <>
            {!question ? (
              <div className="panel">
                <p>
                  Presiona <strong>Comenzar</strong> para cargar la primera pregunta desde el módulo adaptativo.
                </p>
                <div className="resolver-actions" style={{marginTop:12}}>
                  <button className="btn" onClick={() => navigate(-1)}>Volver</button>
                  <button className="btn primary" onClick={startAndLoadFirst}>Comenzar</button>
                </div>
              </div>
            ) : (
              <>
                <div className="question">
                  <div className="questionIndex">Pregunta {numActual}{numMax ? ` / ${numMax}` : ""}</div>
                  <div className="questionText">{question.enunciado}</div>

                  {/* meta de la pregunta */}
                  <div className="muted" style={{marginTop:6}}>
                    Área: <strong>{question.area ?? "—"}</strong>
                    <span style={{marginLeft:12}}>Valor: <strong>{question.valor ?? "—"}</strong></span>
                  </div>

                  <div className="resolver-options">
                    {question.opciones.map((op) => {
                      const isSel = String(selected) === String(op.id_opcion);
                      const feedbackStyle =
                        showFeedback && isSel
                          ? (lastFeedback.correcta ? { borderColor: "#16a34a", boxShadow: "0 0 0 2px #16a34a66" }
                                                    : { borderColor: "#dc2626", boxShadow: "0 0 0 2px #dc262666" })
                          : {};
                      return (
                        <label
                          key={op.id_opcion}
                          className={`radio-row ${isSel ? "is-selected" : ""}`}
                          style={feedbackStyle}
                          onClick={() => setSelected(op.id_opcion)}
                        >
                          <input
                            type="radio"
                            name="opt"
                            checked={isSel}
                            onChange={() => setSelected(op.id_opcion)}
                          />
                          <span className="optionText">{op.texto}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="resolver-actions">
                  <span className="helper">
                    {showFeedback && lastFeedback.correcta != null
                      ? (lastFeedback.correcta ? "¡Correcto!" : "Incorrecto")
                      : "Selecciona una opción y presiona Enviar (Enter)."}
                  </span>
                  <div style={{display:"flex", gap:10}}>
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
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
