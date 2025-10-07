// backend/api/services/area-scores.js
// Cálculo de nota por área con Rasch 1PL (MAP) y escala abierta tipo RIT,
// ahora con soporte para filtrar por evaluación específica.

import db from "../utils/db.js";

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const logistic = (z) => 1 / (1 + Math.exp(-z));

// === Escala RIT-like (configurable por env) ===
const RIT_MID   = Number(process.env.RIT_MID   || 200); // centro de la escala
const RIT_SLOPE = Number(process.env.RIT_SLOPE || 40);  // puntos por Δθ=1
const THETA_MIN = Number(process.env.THETA_MIN || -4);  // límites por estabilidad
const THETA_MAX = Number(process.env.THETA_MAX ||  4);

// CDF Normal estándar (aprox. A&S 7.1.26)
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// θ → escala abierta (RIT-like)
function thetaToRIT(theta) {
  return RIT_MID + RIT_SLOPE * theta;
}

/**
 * Estima θ (MAP) para items {x_i, b_i} normalizados (b en z-score del área).
 * items: [{x:0/1, b:Number, w?:Number}]
 */
function estimateThetaMAP(items, { mu0 = 0, sigma0 = 1, maxIter = 30, tol = 1e-6 } = {}) {
  if (!items?.length) return { theta: 0, se: Infinity, iters: 0 };

  let theta = 0; // inicio en centro del área
  const invVar0 = 1 / (sigma0 * sigma0);

  for (let it = 0; it < maxIter; it++) {
    let g = 0, H = 0; // gradiente y Hessiana (negativa)
    for (const it of items) {
      const w = Number.isFinite(it.w) ? it.w : 1;
      const P = logistic(theta - it.b);
      g += w * ((it.x ? 1 : 0) - P);
      H -= w * P * (1 - P);
    }
    // prior N(mu0, sigma0^2)
    g += (mu0 - theta) * invVar0;
    H -= invVar0;

    const step = g / H;
    theta = clamp(theta - step, THETA_MIN, THETA_MAX);
    if (Math.abs(step) < tol) return { theta, se: 1 / Math.sqrt(-H), iters: it + 1 };
  }
  return { theta, se: NaN, iters: maxIter };
}

/** Media/sd de dificultades por área (para normalizar b a z-score) */
async function fetchAreaStats() {
  const { rows } = await db.query(`
    SELECT
      a."id_area"                           AS id_area,
      COALESCE(a."Nombre", a."nombre")      AS area_nombre,
      AVG(e."Valor"::numeric)               AS mu,
      COALESCE(NULLIF(STDDEV_POP(e."Valor"::numeric),0), 1) AS sigma
    FROM "Pregunta" p
    JOIN "Estandar" e ON e."id_estandar" = p."id_estandar"
    JOIN "Tema"     t ON t."id_tema"     = e."id_tema"
    JOIN "Area"     a ON a."id_area"     = t."id_area"
    GROUP BY a."id_area", COALESCE(a."Nombre", a."nombre")
  `);
  const map = new Map();
  for (const r of rows) {
    map.set(Number(r.id_area), {
      id_area: Number(r.id_area),
      nombre: String(r.area_nombre ?? "Área"),
      mu: Number(r.mu ?? 0),
      sigma: Number(r.sigma ?? 1),
    });
  }
  return map;
}

/**
 * Respuestas del estudiante.
 * Permite filtrar por:
 *   - evaluacionId (id_evaluacion)  ⬅️ si se envía, se usa ese filtro y los demás son opcionales
 *   - carne o id_estudiante
 *   - desde/hasta (fechas)
 */
async function fetchStudentResponses({ evaluacionId, carne, id_estudiante, desde, hasta }) {
  const params = [];
  const where = [];

  if (evaluacionId) {
    params.push(Number(evaluacionId));
    where.push(`ev."id_evaluacion" = $${params.length}`);
  }

  if (carne) {
    params.push(String(carne));
    where.push(`COALESCE(ev."carne_estudiante", ev."carne_est") = $${params.length}`);
  } else if (id_estudiante) {
    params.push(Number(id_estudiante));
    where.push(`(
      (ev."id_matricula" IS NOT NULL AND ev."id_matricula" IN (
        SELECT "id_matricula" FROM "Matricula" WHERE "id_estudiante" = $${params.length}
      ))
      OR EXISTS (
        SELECT 1 FROM "Matricula" m
        WHERE m."id_estudiante" = $${params.length}
          AND COALESCE(m."carne_estudiante", m."carne_est") = COALESCE(ev."carne_estudiante", ev."carne_est")
      )
    )`);
  }

  if (desde) { params.push(desde); where.push(`ev."fecha_inicio" >= $${params.length}`); }
  if (hasta) { params.push(hasta); where.push(`ev."fecha_inicio" <= $${params.length}`); }

  const { rows } = await db.query(
    `
    SELECT
      a."id_area"                              AS id_area,
      COALESCE(a."Nombre", a."nombre")         AS area_nombre,
      p."id_pregunta"                          AS id_pregunta,
      (r."correcta" = TRUE)                    AS correcta,
      COALESCE(r."tiempo_respuesta", 0)::int   AS tiempo_seg,
      (e."Valor")::numeric                     AS valor,
      ev."id_materia"                          AS id_materia
    FROM "Respuesta" r
    JOIN "Evaluacion" ev ON ev."id_evaluacion" = r."id_evaluacion"
    JOIN "Pregunta"  p  ON p."id_pregunta"     = r."id_pregunta"
    JOIN "Estandar"  e  ON e."id_estandar"     = p."id_estandar"
    JOIN "Tema"      t  ON t."id_tema"         = e."id_tema"
    JOIN "Area"      a  ON a."id_area"         = t."id_area"
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY a."id_area", p."id_pregunta"
    `,
    params
  );
  return rows;
}

/** Bandas de nivel sobre percentil (no sobre 0–100 antiguos) */
function percentileToLevel(p) {
  if (p >= 80) return "avanzado";
  if (p >= 60) return "satisfactorio";
  if (p >= 40) return "en_proceso";
  return "inicial";
}

/**
 * Calcula puntajes por área:
 *   - theta, se_theta
 *   - score_rit (escala abierta), se_rit
 *   - percentil (0–100), level
 *   - n (ítems del área en el filtro)
 */
export async function computeAreaScores({ evaluacionId, carne, id_estudiante, desde, hasta }) {
  const areaStats = await fetchAreaStats();
  const rows = await fetchStudentResponses({ evaluacionId, carne, id_estudiante, desde, hasta });

  // Agrupa respuestas por área
  const byArea = new Map();
  for (const r of rows) {
    const id = Number(r.id_area);
    if (!byArea.has(id)) byArea.set(id, []);
    byArea.get(id).push({
      x: r.correcta === true,
      bRaw: Number(r.valor),
      t: Number(r.tiempo_seg || 0),
    });
  }

  const results = [];
  for (const [id_area, itemsRaw] of byArea) {
    const stats = areaStats.get(id_area) || { mu: 0, sigma: 1, nombre: "Área" };
    const mu = Number(stats.mu || 0);
    const sigma = Number(stats.sigma || 1);

    // Normaliza b a z-score del área
    const items = itemsRaw.map(it => ({
      x: it.x ? 1 : 0,
      b: (it.bRaw - mu) / (sigma || 1),
      w: 1, // hook para pesos por tiempo si algún día los activas
    }));

    // Estima θ (MAP)
    const { theta, se } = estimateThetaMAP(items, { mu0: 0, sigma0: 1 });

    // Escala abierta tipo RIT
    const scoreRIT = thetaToRIT(theta);
    const seRIT    = RIT_SLOPE * (isFinite(se) ? se : 0);

    // Percentil (para nivel y UI)
    const percentil = Math.round(100 * normalCdf(theta));
    const level     = percentileToLevel(percentil);

    results.push({
      id_area,
      area: stats.nombre,
      n: items.length,
      theta,
      se_theta: se,
      score_rit: Math.round(scoreRIT),
      se_rit: Math.round(seRIT),
      percentil,
      level,
      mu, sigma,
      rit_mid: RIT_MID, rit_slope: RIT_SLOPE,
    });
  }

  results.sort((a, b) => String(a.area).localeCompare(String(b.area)));
  return results;
}

export default { computeAreaScores };
