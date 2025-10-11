import React, { useEffect, useMemo, useState, useCallback } from "react";
import "./HistorialEvaluacion.css";

/* ====================== Config ====================== */
const API = (import.meta.env.VITE_API_URL || "http://localhost:3001").replace(/\/+$/, "");

/* ====================== Helpers ====================== */
function dig(o, p) {
  try { return p.split(".").reduce((a, k) => (a && a[k] != null ? a[k] : undefined), o); }
  catch { return undefined; }
}
function tryId(obj) {
  const paths = [
    "id_usuario","id",
    "user.id_usuario","user.id",
    "usuario.id_usuario","usuario.id",
    "profile.id_usuario","profile.id",
    "data.id_usuario",
    "auth.user.id_usuario",
    "payload.id_usuario","payload.id",
  ];
  for (const p of paths) {
    const v = dig(obj || {}, p);
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}
function readJSONStorage(getItem, keysSource) {
  const favored = ["auth","session","usuario","user","perfil","profile","state","ctx","context","app"];
  for (const k of favored) {
    const raw = getItem(k); if (!raw) continue;
    try { const parsed = JSON.parse(raw); const id = tryId(parsed); if (Number.isFinite(id)) return id; } catch {}
  }
  try {
    const len = keysSource.length;
    for (let i = 0; i < len; i++) {
      const key = keysSource.key(i); const raw = getItem(key);
      try { const parsed = JSON.parse(raw); const id = tryId(parsed); if (Number.isFinite(id)) return id; } catch {}
    }
  } catch {}
  return null;
}
function decodeJWTMaybe(token) {
  try {
    const parts = String(token).split("."); if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return tryId({ payload });
  } catch { return null; }
}
function getUserIdFromStorages() {
  try { const idLS = readJSONStorage((k)=>localStorage.getItem(k), localStorage); if (Number.isFinite(idLS)) return idLS; } catch {}
  try { const idSS = readJSONStorage((k)=>sessionStorage.getItem(k), sessionStorage); if (Number.isFinite(idSS)) return idSS; } catch {}
  const tokenKeys = ["token","authToken","access_token","jwt","authorization","bearer"];
  for (const k of tokenKeys) {
    const tk = (typeof localStorage !== "undefined" && localStorage.getItem(k)) ||
               (typeof sessionStorage !== "undefined" && sessionStorage.getItem(k));
    const dec = tk && decodeJWTMaybe(tk);
    if (Number.isFinite(dec)) return dec;
  }
  return null;
}
function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d); if (isNaN(dt.getTime())) return String(d);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mi = String(dt.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
function secsToHHMMSS(secs) {
  const s = Math.floor(Number(secs) || 0);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}
function normalizeItems(payload) {
  const arr = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
    ? payload.items
    : [];
  return arr.map((r, i) => ({
    id: Number(r.id ?? r.id_sesion ?? i + 1),
    titulo: r.titulo || r.se_nombre || r.nombre || "Evaluación",
    fecha: r.fecha || r.finalizado_en || r.iniciado_en || r.creado_en || null,
    estado: (r.estado || "").toLowerCase() || "finalizado",
    tiempo: r.tiempo || (Number.isFinite(r.segs) ? secsToHHMMSS(r.segs) : null),
    intento: Number(r.intento ?? 1),
  }));
}

/* ====================== Componente ====================== */
export default function HistorialEvaluacion() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [evalSel, setEvalSel] = useState(null);

  const [userId, setUserId] = useState(() => getUserIdFromStorages());

  useEffect(() => {
    if (userId != null) return;
    let cancel = false;
    (async () => {
      const candidates = [
        `${API}/api/auth/me`,
        `${API}/api/auth/whoami`,
        `${API}/api/sesiones/whoami`,
        `${API}/backend/api/auth/me`,
      ];
      for (const url of candidates) {
        try {
          const r = await fetch(url, { credentials: "include" });
          if (!r.ok) continue;
          const j = await r.json();
          const id = tryId(j);
          if (!cancel && Number.isFinite(id)) {
            setUserId(id);
            break;
          }
        } catch {}
      }
    })();
    return () => { cancel = true; };
  }, [userId]);

  const fetchHistorial = useCallback(async () => {
    setLoading(true);
    setError("");
    setItems([]);
    try {
      const q = userId ? `?${new URLSearchParams({ userId }).toString()}` : "";
      const candidates = [
        `${API}/api/estudiante/historial${q}`,
        `${API}/api/evaluaciones/historial${q}`,
        `${API}/api/docente/evaluaciones${q}`,
      ];

      let lastErr = null;
      for (const url of candidates) {
        try {
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) {
            let info = "";
            try { const j = await res.json(); info = j?.message || j?.error || ""; } catch {}
            throw new Error(`${res.status} ${res.statusText}${info ? " · " + info : ""}`);
          }
          const data = await res.json();
          const norm = normalizeItems(data);
          setItems(norm);
          setError("");
          setLoading(false);
          return;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error("No se pudo consultar el historial en la API.");
    } catch (e) {
      setError(
        `No fue posible cargar el historial. Verifica la API y tus credenciales${
          e?.message ? ` · ${e.message}` : ""
        }.`
      );
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchHistorial(); }, [fetchHistorial]);

  const hayDatos = items && items.length > 0;

  return (
    <section className="he">
      <header className="he-header">
        <h1 className="he-title">Historial de evaluaciones</h1>

        <div className="he-filters card">
          <div className="he-field">
            <span>Usuario</span>
            <div className="muted">
              {userId != null ? `ID: ${userId}` : "No identificado (inicia sesión)"}
            </div>
          </div>
          <div className="he-actions">
            <button className="btn sm" onClick={fetchHistorial} disabled={loading}>
              {loading ? "Cargando…" : "Actualizar"}
            </button>
          </div>
        </div>
      </header>

      <div className="card">
        <table className="table he-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Título</th>
              <th>Intento</th>
              <th>Tiempo</th>
              <th>Estado</th>
              <th className="t-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: "center" }}><span className="muted">Cargando…</span></td></tr>
            ) : error ? (
              <tr><td colSpan={6} style={{ textAlign: "center" }}><span className="error">{error}</span></td></tr>
            ) : !hayDatos ? (
              <tr><td colSpan={6} style={{ textAlign: "center" }}><span className="muted">No hay evaluaciones realizadas.</span></td></tr>
            ) : (
              items.map((ev) => (
                <tr key={`${ev.id}-${ev.intento}`}>
                  <td>{fmtDate(ev.fecha)}</td>
                  <td>{ev.titulo}</td>
                  <td><span className="badge">{ev.intento}</span></td>
                  <td>{ev.tiempo || "—"}</td>
                  <td>
                    <span className={
                      "pill " + (
                        ev.estado === "finalizado" ? "done" :
                        ev.estado === "en_curso" || ev.estado === "activa" ? "warn" : "muted")
                    }>
                      {ev.estado === "finalizado" ? "Completada"
                        : ev.estado === "en_curso" || ev.estado === "activa" ? "Activa"
                        : ev.estado === "programada" ? "Programada" : ev.estado}
                    </span>
                  </td>
                  <td className="t-right">
                    <button className="btn sm" onClick={() => setEvalSel(ev)}>Ver detalle</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {evalSel && (
        <ModalParticipantes evaluacion={evalSel} onClose={() => setEvalSel(null)} />
      )}
    </section>
  );
}

/* ====================== Modal: lista de participantes ====================== */
function ModalParticipantes({ evaluacion, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [alumnoSel, setAlumnoSel] = useState(null);

  const id = evaluacion?.id;

  const fetchParticipantes = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    setRows([]);
    try {
      const candidates = [
        `${API}/api/evaluaciones/${id}/participantes`,
        `${API}/api/docente/evaluaciones/${id}/participantes`,
        `${API}/api/sesion/${id}/participantes`,
        `${API}/api/sesiones/${id}/participantes`,
        `${API}/api/estudiante/evaluaciones/${id}/participantes`,
        `${API}/api/evaluaciones/${id}/resultados`,
      ];

      let lastErr = null;
      for (const url of candidates) {
        try {
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) {
            let info = "";
            try { const j = await res.json(); info = j?.message || j?.error || ""; } catch {}
            throw new Error(`${res.status} ${res.statusText}${info ? " · " + info : ""}`);
          }
          const data = await res.json();
          const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];

          const norm = arr.map((r, i) => {
            const carne =
              r.carne_estudiante ?? r.carne ?? r.id_estudiante ?? r.estudiante_id ?? null;
            const tiempo =
              r.tiempo ||
              (Number.isFinite(r.segs) ? secsToHHMMSS(r.segs) : null) ||
              (r.finished_at && r.started_at
                ? secsToHHMMSS((new Date(r.finished_at) - new Date(r.started_at)) / 1000)
                : null);
            return {
              id_estudiante: carne ?? (r.id ?? i + 1),
              carne: carne ?? "—",
              nombre:
                r.nombre ||
                r.estudiante_nombre ||
                (r.nombres && r.apellidos ? `${r.nombres} ${r.apellidos}` : r.nombres) ||
                "—",
              estado: (r.estado || "").toLowerCase(),
              tiempo,
              started_at: r.started_at || r.iniciado_en || null,
              finished_at: r.finished_at || r.finalizado_en || null,
              raw: r,
            };
          });

          setRows(norm);
          setError("");
          setLoading(false);
          return;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error("No se pudo consultar los participantes en la API.");
    } catch (e) {
      setError(`No fue posible cargar los participantes${e?.message ? ` · ${e.message}` : ""}.`);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchParticipantes(); }, [fetchParticipantes]);

  return (
    <div className="he-modal-overlay" role="dialog" aria-modal="true">
      <div className="he-modal he-modal-xl card">
        <h2 className="card-title">Participantes — {evaluacion?.titulo || `Sesión ${id}`}</h2>

        <div className="mb-2 muted">
          {evaluacion?.fecha ? `Fecha: ${fmtDate(evaluacion.fecha)} · ` : ""}Estado: {evaluacion?.estado || "—"}
        </div>

        <div className="table-wrapper">
          <table className="table he-detail">
            <thead>
              <tr>
                <th>Carne</th>
                <th>Nombre</th>
                <th>Tiempo</th>
                <th>Estado</th>
                <th className="t-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{textAlign:"center"}}><span className="muted">Cargando…</span></td></tr>
              ) : error ? (
                <tr><td colSpan={5} style={{textAlign:"center"}}><span className="error">{error}</span></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} style={{textAlign:"center"}}><span className="muted">No hay participantes.</span></td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={String(r.id_estudiante)}>
                    <td>{r.carne}</td>
                    <td>{r.nombre}</td>
                    <td>{r.tiempo || "—"}</td>
                    <td>
                      <span className={"pill " + (r.estado === "finalizado" ? "done" : (r.estado === "en_curso" || r.estado === "activa" ? "warn" : "muted"))}>
                        {r.estado || "—"}
                      </span>
                    </td>
                    <td className="t-right">
                      <button className="btn sm" onClick={() => setAlumnoSel(r)}>Ver más</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="he-actions">
          <button className="btn" onClick={fetchParticipantes} disabled={loading}>
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </div>

        {alumnoSel && (
          <ModalRecomendaciones
            evaluacionId={id}
            alumno={alumnoSel}
            onClose={() => setAlumnoSel(null)}
          />
        )}
      </div>
    </div>
  );
}

/* ====================== Sub-modal: RECOMENDACIONES por alumno ====================== */
function ModalRecomendaciones({ evaluacionId, alumno, onClose }) {
  // catálogo: { id_estandar, estandar_nombre, area_nombre, rit_valor, codigo? }
  const [catalogo, setCatalogo] = useState([]);
  // items: { id_estandar, motivo, fuente, prioridad, vigente, creado_en, estandar_nombre?, area_nombre?, rit_valor? }
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAll = useCallback(async () => {
    if (!evaluacionId || !alumno) return;
    setLoading(true);
    setError("");
    try {
      const carne = alumno.carne ?? alumno.id_estudiante ?? alumno?.raw?.id_estudiante;

      // 1) catálogo con nombre, área y valor/rit
      const catRes = await fetch(`${API}/api/evaluaciones/${evaluacionId}/estandares`, { credentials:"include" });
      const catJson = catRes.ok ? await catRes.json() : { items: [] };
      const catRaw = Array.isArray(catJson?.items) ? catJson.items : [];
      const cat = catRaw.map(c => ({
        id_estandar: c.id_estandar ?? c.id ?? null,
        estandar_nombre: c.estandar_nombre ?? c.nombre ?? c.descripcion ?? "Estándar",
        area_nombre: c.area_nombre ?? c.area ?? c.tema_nombre ?? "—",
        rit_valor: Number(c.rit_valor ?? c.valor ?? c.peso ?? NaN), // preferimos "valor" (RIT)
        codigo: c.codigo ?? c.id_estandar ?? "",
      }));
      setCatalogo(cat);

      // 2) recomendaciones del alumno
      const candidates = [
        `${API}/api/evaluaciones/${evaluacionId}/participantes/${encodeURIComponent(carne)}/recomendaciones`,
        `${API}/api/recomendaciones/${encodeURIComponent(carne)}?vigentes=1`,
        `${API}/api/evaluaciones/${evaluacionId}/participantes/${encodeURIComponent(carne)}/estandares`,
      ];
      let got = null, lastErr = null;
      for (const url of candidates) {
        try {
          const r = await fetch(url, { credentials:"include" });
          if (!r.ok) {
            let info=""; try{const j=await r.json(); info=j?.message||j?.error||"";}catch{}
            throw new Error(`${r.status} ${r.statusText}${info?` · ${info}`:""}`);
          }
          got = await r.json();
          break;
        } catch(e) { lastErr = e; }
      }
      if (!got) throw lastErr || new Error("No se pudo cargar recomendaciones.");

      const raw = Array.isArray(got) ? got : Array.isArray(got?.items) ? got.items : [];

      const normalized = raw.map((r) => ({
        id_estandar: r.id_estandar ?? r.estandar_id ?? r.id ?? null,
        motivo: r.motivo ?? r.razon ?? r.justificacion ?? null,
        fuente: r.fuente ?? r.source ?? null,
        prioridad: Number(r.prioridad ?? r.priority ?? 1),
        vigente: typeof r.vigente === "boolean" ? r.vigente : (r.activo === true || r.is_active === true ? true : false),
        creado_en: r.creado_en ?? r.created_at ?? r.fecha ?? null,
        estandar_nombre: r.estandar_nombre ?? r.nombre ?? null,
        area_nombre: r.area_nombre ?? r.area ?? null,
        rit_valor: Number(r.rit_valor ?? r.valor ?? NaN),
      }));

      setItems(normalized);
    } catch (e) {
      setError(`No fue posible cargar las recomendaciones${e?.message ? ` · ${e.message}` : ""}.`);
    } finally {
      setLoading(false);
    }
  }, [evaluacionId, alumno]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Merge catálogo -> items (rellena nombre/área/valor/código si faltan)
  const filas = useMemo(() => {
    const map = new Map((catalogo || []).map(c => [String(c.id_estandar), c]));
    return (items || []).map(it => {
      const c = map.get(String(it.id_estandar)) || {};
      return {
        ...it,
        codigo: c.codigo ?? it.id_estandar,
        estandar_nombre: it.estandar_nombre ?? c.estandar_nombre ?? "Estándar",
        area_nombre: it.area_nombre ?? c.area_nombre ?? "—",
        rit_valor: Number.isFinite(it.rit_valor) ? it.rit_valor
                  : Number.isFinite(c.rit_valor) ? c.rit_valor
                  : null,
      };
    });
  }, [catalogo, items]);

  // Agrupar por RIT (usando rit_valor de la BD) de 10 en 10 y luego por Área
  const gruposRender = useMemo(() => {
    const sorted = [...filas].sort((a,b) => {
      const av = Number(a.rit_valor ?? 0);
      const bv = Number(b.rit_valor ?? 0);
      if (av !== bv) return av - bv;
      const an = (a.area_nombre||"").localeCompare(b.area_nombre||"");
      if (an !== 0) return an;
      return Number(b.prioridad||0) - Number(a.prioridad||0);
    });

    const byBand = new Map();
    for (const it of sorted) {
      const rit = Number(it.rit_valor ?? 0);
      const b0 = Math.floor(rit/10)*10;
      const key = `${b0}-${b0+9}`;
      if (!byBand.has(key)) byBand.set(key, []);
      byBand.get(key).push(it);
    }

    const rendered = [];
    for (const [band, arr] of byBand) {
      const [start, end] = band.split("-").map(n => Number(n));
      rendered.push({ __type: "rit", band, start, end, count: arr.length });

      const byArea = new Map();
      for (const it of arr) {
        const area = it.area_nombre || "—";
        if (!byArea.has(area)) byArea.set(area, []);
        byArea.get(area).push(it);
      }
      for (const [area, arr2] of byArea) {
        rendered.push({ __type: "area", area, count: arr2.length, band });
        for (const it of arr2) rendered.push({ __type: "item", ...it });
      }
    }
    return rendered;
  }, [filas]);

  const tot = filas.length;
  const vig = filas.filter(f => f.vigente).length;

  return (
    <div className="he-modal-overlay nested" role="dialog" aria-modal="true">
      <div className="he-modal he-modal-lg card">
        <h3 className="card-title">Prácticas recomendadas — {alumno?.nombre || alumno?.carne || "Alumno"}</h3>
        <div className="mb-2 muted">
          {alumno?.carne ? `Carne: ${alumno.carne} · ` : ""}Recomendaciones vigentes: {vig} / {tot}
        </div>

        {loading ? (
          <div className="muted">Cargando…</div>
        ) : error ? (
          <div className="error">{error}</div>
        ) : gruposRender.length === 0 ? (
          <div className="muted">No hay resultados de recomendaciones para este alumno.</div>
        ) : (
          <div className="table-wrapper tall">
            <table className="table he-detail he-recos">
              <thead>
                <tr>
                  <th style={{width:72}}>Código</th>
                  <th style={{minWidth:320}}>Estándar</th>
                  <th style={{width:180}}>Área</th>
                  <th style={{minWidth:220}}>Motivo</th>
                  <th style={{width:150}}>Fuente</th>
                  <th style={{width:110}}>Prioridad</th>
                  <th style={{width:110}}>Vigente</th>
                  <th style={{width:150}}>Creado</th>
                </tr>
              </thead>
              <tbody>
                {gruposRender.map((r, i) => {
                  if (r.__type === "rit") {
                    return (
                      <tr key={`rit-${r.start}-${i}`} className="row-section">
                        <td colSpan={8} className="muted">
                          <strong>RIT {r.start}–{r.end}</strong> — {r.count}
                        </td>
                      </tr>
                    );
                  }
                  if (r.__type === "area") {
                    return (
                      <tr key={`area-${r.area}-${i}`} className="row-subsection">
                        <td colSpan={8}>
                          <span className="muted">Área:</span> <strong>{r.area}</strong> — {r.count}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={`${r.id_estandar}-${i}`}>
                      <td>{r.codigo}</td>
                      <td className="std-name">
                        <div className="std-title">{r.estandar_nombre || "Estándar"}</div>
                      </td>
                      <td>{r.area_nombre || "—"}</td>
                      <td className="wrap">{r.motivo ?? "—"}</td>
                      <td>{r.fuente ?? "—"}</td>
                      <td><span className="badge">{Number(r.prioridad || 1)}</span></td>
                      <td>
                        <span className={"pill " + (r.vigente ? "done" : "muted")}>
                          {r.vigente ? "Sí" : "No"}
                        </span>
                      </td>
                      <td>{fmtDate(r.creado_en)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="he-actions">
          <button className="btn" onClick={fetchAll} disabled={loading}>
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
