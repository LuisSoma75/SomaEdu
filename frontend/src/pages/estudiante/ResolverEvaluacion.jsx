// src/pages/estudiante/ResolverEvaluacion.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import styles from "./ResolverEvaluacion.module.css"; // ⬅️ módulo, NO global

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

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

  const [numMax, setNumMax]             = useState(null);
  const [numActual, setNumActual]       = useState(0);
  const [finished, setFinished]         = useState(false);

  const [question, setQuestion] = useState(null);
  const [selected, setSelected] = useState(null);

  const [lastAnswer, setLastAnswer] = useState(null); // {id_opcion, correcta}
  const [showFeedback, setShowFeedback] = useState(false);

  const [tiempoTotalSeg, setTiempoTotalSeg] = useState(null);
  const [tiempoRestanteSeg, setTiempoRestanteSeg] = useState(null);
  const timerRef = useRef(null);

  const startTickRef = useRef(Date.now());

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

  const formatMMSS = useCallback((s) => {
    if (s == null) return null;
    const sec = Math.max(0, s|0);
    const mm = String(Math.floor(sec/60)).padStart(2,"0");
    const ss = String(sec%60).padStart(2,"0");
    return `${mm}:${ss}`;
  }, []);

  const normalizeQuestion = useCallback((qRaw) => {
    if (!qRaw) return null;
    return {
      id_pregunta: qRaw.id_pregunta ?? qRaw.id ?? qRaw.question_id,
      enunciado:   qRaw.enunciado   ?? qRaw.texto ?? qRaw.text ?? "Enunciado no disponible",
      opciones:    (qRaw.opciones ?? qRaw.options ?? []).map((o) => ({
        id_opcion: o.id_opcion ?? o.id ?? o.value,
        texto:     o.texto ?? o.label ?? o.descripcion ?? o.text ?? "Opción",
      })),
    };
  }, []);

  const fetchSessionMeta = useCallback(async () => {
    const endpoints = [
      `${API}/api/estudiante/evaluaciones?userId=${idUsuario ?? ""}`,
      `${API}/api/estudiante/evaluaciones?carne=${encodeURIComponent(carne ?? "")}`,
    ];
    for (const url of endpoints) {
      try {
        const j = await fetchJSON(url);
        const arr = Array.isArray(j.items ?? j.data ?? j) ? (j.items ?? j.data ?? j) : [];
        const match = arr.find((x) => {
          const ids = [x.id, x.id_sesion, x.sessionId, x.sesion_id].filter((v) => v != null);
          return ids.some((v) => Number(v) === sid);
        });
        if (match) {
          const materia = match.id_materia ?? match.materia_id ?? null;
          const nmax    = match.num_preg_max ?? match.num_preguntas ?? null;
          if (materia != null) {
            return {
              id_materia: Number(materia),
              num_preg_max: (nmax != null && Number(nmax) > 0) ? Number(nmax) : null
            };
          }
        }
      } catch (e) { warn("falló meta desde", url, e); }
    }
    throw new Error("No se encontró id_materia para la sesión.");
  }, [API, idUsuario, carne, sid, fetchJSON]);

  const startAndLoadFirst = useCallback(async () => {
    setLoading(true); setError(""); setFinished(false);
    setQuestion(null); setSelected(null); setLastAnswer(null); setShowFeedback(false);
    setNumActual(0); setTiempoTotalSeg(null); setTiempoRestanteSeg(null);
    clearInterval(timerRef.current);

    try {
      try { await fetch(`${API}/api/waitroom/${sid}/start`, { method: "POST" }); } catch (e) { warn("waitroom.start:", e.message); }
      const meta = await fetchSessionMeta();
      setIdMateria(meta.id_materia);
      setNumMax(meta.num_preg_max);

      const body = {
        carne_estudiante: String(estudianteId),
        id_materia: meta.id_materia,
        num_preg_max: meta.num_preg_max ?? undefined,
        id_sesion: Number.isFinite(sid) ? sid : undefined,
        sessionId: Number.isFinite(sid) ? sid : undefined,
      };
      const startRes = await fetchJSON(`${API}/api/adaptative/session/start`, { method: "POST", body: JSON.stringify(body) });

      const q = normalizeQuestion(startRes?.question || startRes?.data?.question || startRes?.data);
      if (!q) throw new Error("El servidor no devolvió una pregunta inicial.");

      setIdEvaluacion(Number(startRes.id_evaluacion));
      setValorStd(Number(startRes.valor_estandar ?? 0));
      setQuestion(q);
      setSelected(null);
      setNumActual(1);
      startTickRef.current = Date.now();

      const tlim = startRes?.tiempo_limite_seg;
      if (tlim != null && Number(tlim) > 0) {
        setTiempoTotalSeg(Number(tlim));
        setTiempoRestanteSeg(Number(tlim));
        timerRef.current = setInterval(() => {
          setTiempoRestanteSeg((s) => {
            if (s == null) return s;
            if (s <= 1) { clearInterval(timerRef.current); return 0; }
            return s - 1;
          });
        }, 1000);
      }
    } catch (e) {
      setError(e.message || "No se pudo iniciar la evaluación.");
    } finally { setLoading(false); }
  }, [API, sid, estudianteId, fetchJSON, fetchSessionMeta, normalizeQuestion]);

  const submitAnswer = useCallback(async () => {
    if (!question || selected == null || !idEvaluacion || !idMateria) return;
    if (showFeedback) return;
    setSubmitting(true); setError("");

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

      setLastAnswer({ id_opcion: Number(selected), correcta: !!ans.correcta });
      setShowFeedback(true);

      if (ans.finished) {
        await new Promise(r => setTimeout(r, 800));
        setFinished(true); setQuestion(null); setSelected(null); setShowFeedback(false);
        try { await fetchJSON(`${API}/api/adaptative/session/${idEvaluacion}/end`, { method: "POST" }); } catch (e) { warn("end:", e.message); }
        return;
      }

      const nextQ = normalizeQuestion(ans.question);
      if (!nextQ) {
        await new Promise(r => setTimeout(r, 800));
        setFinished(true); setQuestion(null); setSelected(null); setShowFeedback(false);
        try { await fetchJSON(`${API}/api/adaptative/session/${idEvaluacion}/end`, { method: "POST" }); } catch {}
        return;
      }

      await new Promise(r => setTimeout(r, 700));
      setValorStd(Number(ans.valor_estandar ?? valorStd));
      setQuestion(nextQ);
      setSelected(null);
      setNumActual((n) => n + 1);
      setShowFeedback(false);
      startTickRef.current = Date.now();
    } catch (e) {
      setError(e.message || "No se pudo enviar la respuesta.");
      setShowFeedback(false);
    } finally { setSubmitting(false); }
  }, [API, fetchJSON, idEvaluacion, idMateria, question, selected, valorStd, normalizeQuestion, showFeedback]);

  const handleEnd = useCallback(async () => {
    if (idEvaluacion) {
      try { await fetchJSON(`${API}/api/adaptative/session/${idEvaluacion}/end`, { method: "POST" }); } catch (e) { warn("end:", e.message); }
    }
    setFinished(true); setQuestion(null); setSelected(null); setShowFeedback(false);
    clearInterval(timerRef.current);
  }, [API, idEvaluacion, fetchJSON]);

  useEffect(() => {
    if (tiempoRestanteSeg === 0 && !finished) handleEnd();
  }, [tiempoRestanteSeg, finished, handleEnd]);

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === "Enter" && !loading && !submitting && question && selected != null && !showFeedback) {
        submitAnswer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loading, submitting, question, selected, submitAnswer, showFeedback]);

  useEffect(() => () => clearInterval(timerRef.current), []);

  const progressPct = useMemo(() => {
    if (!numMax || numMax <= 0) return 0;
    const pct = Math.min(100, Math.max(0, ((numActual - 1) / numMax) * 100));
    return pct.toFixed(2);
  }, [numActual, numMax]);

  if (!estudianteId) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <header className={styles.header}>
            <h1 className={styles.title}>Resolver evaluación</h1>
            <span className={styles.chip}>Sesión #{sid}</span>
          </header>
          <div className={`${styles.panel} ${styles.alertError}`}>
            No hay sesión de estudiante válida. Inicia sesión nuevamente.
            <div style={{ marginTop: 12 }}>
              <button className={styles.btn} onClick={() => navigate("/")}>Ir a Login</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page} data-testid="resolver-page">
      <div className={styles.card}>
        <header className={styles.header}>
          <h1 className={styles.title}>Resolviendo evaluación</h1>
          <div className={styles.meta}>
            {numActual > 0 && !finished && (
              <span className={styles.chip}>Pregunta {numActual}{numMax ? ` / ${numMax}` : ""}</span>
            )}
            <span className={styles.chip}>Valor: {Number(valorStd ?? 0).toFixed(2)}</span>
            {tiempoTotalSeg != null && (
              <span className={`${styles.chip} ${styles.timer}`}>⏱ {formatMMSS(tiempoRestanteSeg)}</span>
            )}
          </div>
        </header>

        <div className={styles.progress} style={{["--progress"]: `${progressPct}%`}}>
          <div className={styles.progressBar} />
        </div>

        {loading && <div className={styles.panel}>Preparando evaluación…</div>}
        {error && <div className={`${styles.panel} ${styles.alertError}`}>{error}</div>}
        {finished && (
          <section className={`${styles.panel} ${styles.alertSuccess}`} style={{marginTop: 10}}>
            <h3 style={{ marginTop: 0 }}>¡Sesión finalizada!</h3>
            <p>Gracias por participar.</p>
            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <button className={styles.btn} onClick={() => navigate(-1)}>Volver</button>
            </div>
          </section>
        )}

        {!loading && !error && !finished && (
          <>
            {!question ? (
              <section className={styles.panel} style={{marginTop: 10}}>
                <p>
                  Presiona <strong>Comenzar</strong> para cargar la primera pregunta desde el módulo adaptativo.
                </p>
                <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                  <button className={styles.btn} onClick={() => navigate(-1)}>Volver</button>
                  <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={startAndLoadFirst}>Comenzar</button>
                </div>
              </section>
            ) : (
              <>
                <section className={styles.question}>
                  <div className={styles.questionIndex}>Pregunta #{numActual}</div>
                  <div className={styles.questionText}>{question.enunciado}</div>

                  <div className={styles.options}>
                    {question.opciones.map((op) => {
                      const isSelected = String(selected) === String(op.id_opcion);
                      const isCorrect = showFeedback && lastAnswer?.id_opcion === op.id_opcion && lastAnswer?.correcta === true;
                      const isWrong   = showFeedback && lastAnswer?.id_opcion === op.id_opcion && lastAnswer?.correcta === false;

                      return (
                        <label
                          key={op.id_opcion}
                          className={[
                            styles.option,
                            isSelected && styles.optionSelected,
                            isCorrect && styles.optionCorrect,
                            isWrong   && styles.optionWrong
                          ].filter(Boolean).join(" ")}
                          onClick={() => !submitting && !showFeedback && setSelected(op.id_opcion)}
                        >
                          <input
                            type="radio"
                            name="answer"
                            checked={isSelected}
                            onChange={() => setSelected(op.id_opcion)}
                            disabled={submitting || showFeedback}
                          />
                          <div className={styles.optionText}>{op.texto}</div>
                          {isCorrect && <span className={styles.optionBadge}>Correcta</span>}
                          {isWrong   && <span className={styles.optionBadge}>Incorrecta</span>}
                        </label>
                      );
                    })}
                  </div>
                </section>

                <footer className={styles.footer}>
                  <span className={styles.helper}>
                    {numMax ? `${numActual} de ${numMax}` : `Pregunta ${numActual}`}
                  </span>
                  <div>
                    <button className={`${styles.btn} ${styles.btnGhost}`} onClick={handleEnd} disabled={submitting || showFeedback}>
                      Finalizar
                    </button>
                    <button
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      style={{marginLeft: 8}}
                      disabled={selected == null || submitting || showFeedback}
                      onClick={submitAnswer}
                      title={selected == null ? "Selecciona una opción" : "Enviar respuesta"}
                    >
                      {submitting ? "Enviando…" : "Enviar"}
                    </button>
                  </div>
                </footer>
              </>
            )}
          </>
        )}
      </div>

      {showFeedback && (
        <div className={`${styles.toast} ${lastAnswer?.correcta ? styles.toastOk : styles.toastErr}`}>
          {lastAnswer?.correcta ? "✅ ¡Respuesta correcta!" : "❌ Respuesta incorrecta"}
        </div>
      )}
    </div>
  );
}
