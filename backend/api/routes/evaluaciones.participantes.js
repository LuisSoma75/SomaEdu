// backend/api/routes/evaluaciones.participantes.js
import express from "express";
import db from "../utils/db.js";

const router = express.Router();

/* =========== helpers =========== */
function parseSesionId(id) {
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function secsToHHMMSS(secs) {
  const s = Math.floor(Number(secs) || 0);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}
/** SELECT tolerante: si la tabla/columna no existe, devuelve null (no explota). */
async function trySelect(sql, params) {
  try {
    const { rows } = await db.query(sql, params);
    return rows || [];
  } catch {
    return null;
  }
}

/* ======= fuentes de PUNTAJE ======= */
/** 1) Map {carne -> puntaje} desde tablas de resumen de nota. */
async function scoreFromResumen(id_sesion) {
  const candidates = [
    `SELECT carne_estudiante, puntaje FROM "Sesion_resumen_alumno" WHERE id_sesion=$1`,
    `SELECT carne_estudiante, puntaje FROM "Sesion_puntaje" WHERE id_sesion=$1`,
    `SELECT carne_estudiante, puntaje FROM "Sesion_nota_alumno" WHERE id_sesion=$1`,
    `SELECT carne_estudiante, nota AS puntaje FROM "Evaluacion_resultado" WHERE id_sesion=$1`,
  ];
  for (const sql of candidates) {
    const rows = await trySelect(sql, [id_sesion]);
    if (rows && rows.length) {
      return Object.fromEntries(
        rows
          .filter(r => r.carne_estudiante != null)
          .map(r => [String(r.carne_estudiante), Number(r.puntaje)])
      );
    }
  }
  return {};
}

/** 2) Map {carne -> puntaje%} desde RESPUESTAS (aciertos/total * 100). */
async function scoreFromRespuestas(id_sesion) {
  const candidates = [
    `SELECT carne_estudiante, SUM(CASE WHEN es_correcta THEN 1 ELSE 0 END)::int aciertos, COUNT(*)::int total
       FROM "Sesion_respuesta" WHERE id_sesion=$1 GROUP BY carne_estudiante`,
    `SELECT carne_estudiante, SUM(CASE WHEN correcta THEN 1 ELSE 0 END)::int aciertos, COUNT(*)::int total
       FROM "Sesion_respuesta" WHERE id_sesion=$1 GROUP BY carne_estudiante`,
    `SELECT carne_estudiante, SUM(CASE WHEN es_correcta THEN 1 ELSE 0 END)::int aciertos, COUNT(*)::int total
       FROM "Respuesta_estudiante" WHERE id_sesion=$1 GROUP BY carne_estudiante`,
    `SELECT carne_estudiante, SUM(CASE WHEN es_correcta THEN 1 ELSE 0 END)::int aciertos, COUNT(*)::int total
       FROM "Respuestas" WHERE id_sesion=$1 GROUP BY carne_estudiante`,
  ];
  for (const sql of candidates) {
    const rows = await trySelect(sql, [id_sesion]);
    if (rows && rows.length) {
      const by = {};
      for (const r of rows) {
        const total = Number(r.total) || 0;
        const ok = Number(r.aciertos) || 0;
        by[String(r.carne_estudiante)] = total > 0 ? Math.round((ok * 100) / total) : null;
      }
      return by;
    }
  }
  return {};
}

/** 3) Map {carne -> puntaje%} desde ESTÁNDARES (cumplidos/total * 100). */
async function scoreFromEstandares(id_sesion) {
  const candidates = [
    // formato típico: bool cumple
    `SELECT carne_estudiante,
            SUM(CASE WHEN cumple THEN 1 ELSE 0 END)::int ok,
            COUNT(*)::int total
       FROM "Sesion_estandar_resultado"
      WHERE id_sesion=$1
      GROUP BY carne_estudiante`,
    // variantes de columna booleana
    `SELECT carne_estudiante,
            SUM(CASE WHEN cumplido THEN 1 ELSE 0 END)::int ok,
            COUNT(*)::int total
       FROM "Sesion_estandar_resultado"
      WHERE id_sesion=$1
      GROUP BY carne_estudiante`,
    // otros nombres de tabla
    `SELECT carne_estudiante,
            SUM(CASE WHEN cumple THEN 1 ELSE 0 END)::int ok,
            COUNT(*)::int total
       FROM "Evaluacion_estandar_resultado"
      WHERE id_sesion=$1
      GROUP BY carne_estudiante`,
  ];
  for (const sql of candidates) {
    const rows = await trySelect(sql, [id_sesion]);
    if (rows && rows.length) {
      const by = {};
      for (const r of rows) {
        const total = Number(r.total) || 0;
        const ok = Number(r.ok) || 0;
        by[String(r.carne_estudiante)] = total > 0 ? Math.round((ok * 100) / total) : null;
      }
      return by;
    }
  }
  return {};
}

/** Combina fuentes de puntaje en orden de prioridad. */
async function getPuntajesByCarne(id_sesion) {
  const a = await scoreFromResumen(id_sesion);
  if (Object.keys(a).length) return a;
  const b = await scoreFromRespuestas(id_sesion);
  if (Object.keys(b).length) return b;
  const c = await scoreFromEstandares(id_sesion);
  return c;
}

/* ====== catálogo y resultados de ESTÁNDARES ====== */

/** GET lista de estándares definidos para la evaluación/sesión */
router.get("/:id/estandares", async (req, res, next) => {
  try {
    const id_sesion = parseSesionId(req.params.id);
    if (!id_sesion) return res.status(400).json({ ok:false, error:"bad_request", message:"id inválido" });

    // buscamos id_clase / id_materia para filtrar estándares si aplica
    const info = await trySelect(
      `SELECT se.id_clase, c.id_materia
         FROM "Sesion_evaluacion" se
         JOIN "Clase" c ON c.id_clase = se.id_clase
        WHERE se.id_sesion=$1 LIMIT 1`, [id_sesion]
    );
    const id_materia = info?.[0]?.id_materia ?? null;

    // candidatos de catálogos
    const cats = [
      // por materia
      [`SELECT id_estandar, codigo, nombre, descripcion, peso FROM "Estandar_practica" WHERE id_materia=$1 ORDER BY codigo ASC`, [id_materia]],
      // globales
      [`SELECT id_estandar, codigo, nombre, descripcion, peso FROM "Estandar_practica" ORDER BY codigo ASC`, []],
      [`SELECT id_estandar, codigo, nombre, descripcion, peso FROM "Estandares" ORDER BY codigo ASC`, []],
    ];
    for (const [sql, params] of cats) {
      const rows = await trySelect(sql, params);
      if (rows && rows.length) {
        return res.json({ ok:true, items: rows.map(r => ({
          id_estandar: r.id_estandar,
          codigo: r.codigo ?? null,
          nombre: r.nombre ?? null,
          descripcion: r.descripcion ?? null,
          peso: Number(r.peso ?? 1),
        }))});
      }
    }
    return res.json({ ok:true, items: [] });
  } catch (e) {
    next(e);
  }
});

/** GET resultados de estándares de un alumno */
router.get("/:id/participantes/:carne/estandares", async (req, res, next) => {
  try {
    const id_sesion = parseSesionId(req.params.id);
    const carne = req.params.carne?.trim();
    if (!id_sesion || !carne) {
      return res.status(400).json({ ok:false, error:"bad_request", message:"parámetros inválidos" });
    }

    const candidates = [
      // id_estandar, cumple, nivel(1..5?), observacion, evidencia_url
      `SELECT id_estandar, cumple, nivel, observacion, evidencia_url
         FROM "Sesion_estandar_resultado"
        WHERE id_sesion=$1 AND carne_estudiante=$2
        ORDER BY id_estandar ASC`,
      `SELECT id_estandar, cumplido AS cumple, nivel, observacion, evidencia_url
         FROM "Sesion_estandar_resultado"
        WHERE id_sesion=$1 AND carne_estudiante=$2
        ORDER BY id_estandar ASC`,
      `SELECT id_estandar, cumple, nivel, observacion, evidencia_url
         FROM "Evaluacion_estandar_resultado"
        WHERE id_sesion=$1 AND carne_estudiante=$2
        ORDER BY id_estandar ASC`,
    ];
    for (const sql of candidates) {
      const rows = await trySelect(sql, [id_sesion, carne]);
      if (rows && rows.length) {
        const total = rows.length;
        const ok = rows.reduce((a, r) => a + (r.cumple ? 1 : 0), 0);
        return res.json({
          ok: true,
          resumen: { cumplidos: ok, total, porcentaje: total > 0 ? Math.round((ok*100)/total) : null },
          items: rows.map(r => ({
            id_estandar: r.id_estandar,
            cumple: !!r.cumple,
            nivel: r.nivel ?? null,
            observacion: r.observacion ?? null,
            evidencia_url: r.evidencia_url ?? null,
          })),
        });
      }
    }
    return res.json({ ok:true, resumen:{ cumplidos:null, total:null, porcentaje:null }, items: [] });
  } catch (e) {
    next(e);
  }
});

/* ====== participantes + puntaje ====== */
/**
 * GET /api/evaluaciones/:id/participantes
 * Query:
 *  - scope=participantes|inscritos
 *  - all=1 (mezcla ambos)
 */
router.get("/:id/participantes", async (req, res, next) => {
  try {
    const id_sesion = parseSesionId(req.params.id);
    if (!id_sesion) return res.status(400).json({ ok:false, error:"bad_request", message:"id de sesión inválido" });

    const scope = String(req.query.scope || "").toLowerCase();
    const wantAll = String(req.query.all || "") === "1";

    // sesión -> grado
    const { rows: rSe } = await db.query(
      `SELECT se.id_sesion, se.iniciado_en, se.finalizado_en, se.estado, se.id_clase, c.id_grado
         FROM "Sesion_evaluacion" se
         JOIN "Clase" c ON c.id_clase = se.id_clase
        WHERE se.id_sesion = $1
        LIMIT 1`,
      [id_sesion]
    );
    if (!rSe.length) return res.status(404).json({ ok:false, error:"not_found", message:"Sesión no encontrada" });
    const se = rSe[0];

    // participantes reales
    const { rows: rPart } = await db.query(
      `SELECT
         sp.id_estudiante                                    AS carne,
         COALESCE(u."Nombre",'—')                            AS nombre,
         COALESCE(sp.estado, '')                             AS estado,
         se.iniciado_en                                      AS started_at,
         se.finalizado_en                                     AS finished_at,
         EXTRACT(EPOCH FROM (se.finalizado_en - se.iniciado_en)) AS segs
       FROM "Sesion_participante" sp
       JOIN "Sesion_evaluacion" se ON se.id_sesion = sp.id_sesion
       LEFT JOIN "Estudiantes" e   ON e."carne_estudiante" = sp.id_estudiante
       LEFT JOIN "Usuarios"    u   ON u."id_usuario"       = e."id_usuario"
      WHERE sp.id_sesion = $1
      ORDER BY sp.joined_at ASC`,
      [id_sesion]
    );

    let participantes = rPart.map((r) => ({
      carne: r.carne ?? "—",
      nombre: r.nombre ?? "—",
      estado: String(r.estado || "").toLowerCase(),
      tiempo: Number.isFinite(r.segs) && r.segs >= 0 ? secsToHHMMSS(r.segs) : null,
      started_at: r.started_at,
      finished_at: r.finished_at,
      puntaje: null,
    }));

    if (scope === "participantes" && !wantAll) {
      const by = await getPuntajesByCarne(id_sesion);
      if (by && Object.keys(by).length) {
        participantes = participantes.map(p => ({ ...p, puntaje: by[String(p.carne)] ?? p.puntaje }));
      }
      return res.json({ ok:true, items: participantes });
    }

    // inscritos esperados por grado
    const { rows: rInsc } = await db.query(
      `SELECT e."carne_estudiante" AS carne, COALESCE(u."Nombre",'—') AS nombre
         FROM "Estudiantes" e
         JOIN "Usuarios" u ON u."id_usuario" = e."id_usuario"
        WHERE e."id_grado" = $1
        ORDER BY u."Nombre" ASC`,
      [se.id_grado]
    );

    const mapPart = new Map(participantes.map(p => [String(p.carne), p]));
    let inscritos = rInsc.map((r) => {
      const k = String(r.carne);
      const real = mapPart.get(k);
      if (real) return real;
      return { carne:r.carne ?? "—", nombre:r.nombre ?? "—", estado:"no_ingreso", tiempo:null, started_at:null, finished_at:null, puntaje:null };
    });

    let items;
    if (scope === "inscritos" && !wantAll) items = inscritos;
    else if (participantes.length > 0 || wantAll) {
      const setCarne = new Set(inscritos.map(i => String(i.carne)));
      const extras = participantes.filter(p => !setCarne.has(String(p.carne)));
      items = inscritos.concat(extras);
    } else items = inscritos;

    // Rellenar puntajes con la mejor fuente disponible
    const by = await getPuntajesByCarne(id_sesion);
    if (by && Object.keys(by).length) {
      items = items.map(p => ({ ...p, puntaje: by[String(p.carne)] ?? p.puntaje }));
    }

    res.json({ ok:true, items });
  } catch (err) {
    next(err);
  }
});

/* ===== detalle por alumno (incluye estándares) ===== */
router.get("/:id/participantes/:carne/detalle", async (req, res, next) => {
  try {
    const id_sesion = parseSesionId(req.params.id);
    const carne = req.params.carne?.trim();
    if (!id_sesion || !carne) {
      return res.status(400).json({ ok:false, error:"bad_request", message:"parámetros inválidos" });
    }

    const { rows: rBase } = await db.query(
      `SELECT
         se.iniciado_en AS started_at,
         se.finalizado_en AS finished_at,
         sp.estado AS estado
       FROM "Sesion_evaluacion" se
       LEFT JOIN "Sesion_participante" sp
         ON sp.id_sesion = se.id_sesion AND sp.id_estudiante = $2
      WHERE se.id_sesion = $1
      LIMIT 1`,
      [id_sesion, carne]
    );
    const base = rBase[0] || {};
    const segs = base.finished_at && base.started_at
      ? (new Date(base.finished_at) - new Date(base.started_at)) / 1000
      : null;

    // puntaje por carne (cualquiera de las fuentes)
    const by = await getPuntajesByCarne(id_sesion);
    let puntaje = by[String(carne)] ?? null;

    // RESUMEN de estándares por alumno (para mostrar cumplidos/total y %)
    const est = await trySelect(
      `SELECT id_estandar, 
              COALESCE(cumple, cumplido, false) AS cumple,
              nivel, observacion, evidencia_url
         FROM "Sesion_estandar_resultado"
        WHERE id_sesion=$1 AND carne_estudiante=$2
        ORDER BY id_estandar ASC`,
      [id_sesion, carne]
    ) || await trySelect(
      `SELECT id_estandar, 
              COALESCE(cumple, cumplido, false) AS cumple,
              nivel, observacion, evidencia_url
         FROM "Evaluacion_estandar_resultado"
        WHERE id_sesion=$1 AND carne_estudiante=$2
        ORDER BY id_estandar ASC`,
      [id_sesion, carne]
    ) || [];

    let cumplidos = null, total = null;
    if (est.length) {
      total = est.length;
      cumplidos = est.reduce((a, r) => a + (r.cumple ? 1 : 0), 0);
      if (puntaje == null) puntaje = Math.round((cumplidos * 100) / total);
    }

    const resumen = {
      puntaje,
      aciertos: null,
      total: null,
      estandares: { cumplidos, total, porcentaje: (total && cumplidos!=null) ? Math.round((cumplidos*100)/total) : null },
      tiempo: Number.isFinite(segs) && segs >= 0 ? secsToHHMMSS(segs) : null,
      iniciado_en: base.started_at || null,
      finalizado_en: base.finished_at || null,
      estado: base.estado || "no_ingreso",
    };

    res.json({
      ok: true,
      data: {
        resumen,
        estandares: est.map(r => ({
          id_estandar: r.id_estandar,
          cumple: !!r.cumple,
          nivel: r.nivel ?? null,
          observacion: r.observacion ?? null,
          evidencia_url: r.evidencia_url ?? null,
        })),
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
