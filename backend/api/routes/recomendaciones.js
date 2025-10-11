// backend/api/routes/recomendaciones.js
import express from "express";
const router = express.Router();

/* ========= Carga robusta del módulo de BD, con fallback a pg ========= */
async function loadDB() {
  const tryPaths = [
    "../db/index.js", "../db.js", "../../db.js",
    "../db.cjs", "../../db.cjs",
  ];
  for (const p of tryPaths) {
    try {
      const mod = await import(p);
      const m = mod?.default ?? mod;
      const candidate =
        (m && typeof m.query === "function" && m) ||
        (m?.pool && typeof m.pool.query === "function" && m.pool) ||
        null;
      if (candidate) return candidate;
    } catch {}
  }
  try {
    const { Pool } = await import("pg");
    const cs = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PGURL;
    if (!cs) throw new Error("DATABASE_URL no definido");
    const sslOff = String(process.env.PGSSL_DISABLE || "").toLowerCase();
    const ssl = sslOff === "1" || sslOff === "true" ? false : { rejectUnauthorized: false };
    const pool = new Pool({ connectionString: cs, ssl });
    return { query: (t, p) => pool.query(t, p), _pool: pool };
  } catch (e) {
    console.error("[recomendaciones] Fallback pg Pool falló:", e?.message);
    return null;
  }
}
const db = await loadDB();
if (!db) throw new Error("[recomendaciones] No se pudo cargar el módulo de BD ni crear Pool");
const q = (sql, params = []) => db.query(sql, params);

/* ====================== Helpers ====================== */
const toInt = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const asBoolOrNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  if (["1","true","t","yes","y","si","sí"].includes(s)) return true;
  if (["0","false","f","no","n"].includes(s)) return false;
  return null;
};

async function getMateriaDeSesion(id_sesion) {
  const { rows } = await q(
    `SELECT c.id_materia
       FROM "Sesion_evaluacion" se
       JOIN "Clase" c ON c.id_clase = se.id_clase
      WHERE se.id_sesion = $1
      LIMIT 1`,
    [id_sesion]
  );
  return rows?.[0]?.id_materia ?? null;
}

/* Convierte carne (o algo numérico) → id_usuario.
   Si no existe Estudiantes con ese carne, asumimos que ya es id_usuario. */
async function toUserIdFromCarneOrId(value) {
  const n = toInt(value);
  if (n == null) return null;
  try {
    const { rows } = await q(
      `SELECT id_usuario
         FROM "Estudiantes"
        WHERE carne_estudiante = $1
        LIMIT 1`,
      [n]
    );
    if (rows?.[0]?.id_usuario != null) return Number(rows[0].id_usuario);
  } catch {}
  return n;
}

/* Utilidad: prueba consultas en orden (para compatibilidad) */
async function firstSuccessfulQuery(queries) {
  for (const { sql, params = [] } of queries) {
    try {
      const { rows } = await q(sql, params);
      return rows;
    } catch {}
  }
  return [];
}

/* ====================== Catálogo de estándares por sesión ====================== */
/* Devuelve estándares desde Estandar ← Tema ← Area, con nombre de área y valor (RIT) */
router.get("/evaluaciones/:id/estandares", async (req, res, next) => {
  try {
    const id_sesion = toInt(req.params.id);
    if (!id_sesion) return res.status(400).json({ ok:false, error:"bad_request" });

    const id_materia = await getMateriaDeSesion(id_sesion);

    const rows = await firstSuccessfulQuery([
      {
        // Catálogo real que mostraste en las capturas
        sql: `SELECT e.id_estandar,
                     e."Nombre"         AS estandar_nombre,
                     e."Valor"          AS rit_valor,
                     t.id_tema,
                     t."Nombre"         AS tema_nombre,
                     a.id_area,
                     a."Nombre"         AS area_nombre,
                     a.id_materia
                FROM "Estandar" e
                LEFT JOIN "Tema"  t ON t.id_tema  = e.id_tema
                LEFT JOIN "Area"  a ON a.id_area  = t.id_area
               WHERE $1::int IS NULL OR a.id_materia = $1
               ORDER BY e."Valor" ASC, e.id_estandar ASC`,
        params: [id_materia],
      },
      {
        // Fallbacks antiguos
        sql: `SELECT id_estandar, nombre AS estandar_nombre, NULL::int AS rit_valor,
                     NULL::int AS id_tema, NULL::text AS tema_nombre,
                     NULL::int AS id_area, NULL::text AS area_nombre, NULL::int AS id_materia
                FROM "Estandares"
               ORDER BY id_estandar ASC`,
      },
      {
        sql: `SELECT NULL::int AS id_estandar, NULL::text AS estandar_nombre,
                     NULL::int AS rit_valor, NULL::int AS id_tema, NULL::text AS tema_nombre,
                     NULL::int AS id_area, NULL::text AS area_nombre, NULL::int AS id_materia
                WHERE false`,
      },
    ]);

    return res.json({ ok:true, items: rows });
  } catch (e) { next(e); }
});

/* ============== Recomendaciones por alumno dentro de una sesión ============== */
async function recomendacionesPorSesionYCarne(req, res, next) {
  try {
    const id_sesion = toInt(req.params.id);
    const carneParam = req.params.carne?.trim();
    if (!id_sesion || !carneParam) return res.status(400).json({ ok:false, error:"bad_request" });

    // En tu tabla recomendacion_estandar, carne_estudiante = id_usuario
    const usuarioId = await toUserIdFromCarneOrId(carneParam);
    if (usuarioId == null) return res.json({ ok:true, resumen:{vigentes:0,total:0}, items: [] });

    const soloVigentes = asBoolOrNull(req.query.vigentes ?? "1"); // default: TRUE
    const id_materia = await getMateriaDeSesion(id_sesion);

    const filtrosBase = [`r.carne_estudiante = $1`];
    if (soloVigentes !== null) filtrosBase.push(`r.vigente = ${soloVigentes ? "TRUE" : "FALSE"}`);

    const rows = await firstSuccessfulQuery([
      {
        // JOIN al catálogo real para traer nombre del estándar, área y valor (RIT)
        sql: `
          SELECT r.id_rec, r.carne_estudiante, r.id_estandar, r.motivo, r.fuente,
                 r.prioridad, r.vigente, r.creado_en,
                 e."Nombre" AS estandar_nombre,
                 e."Valor"  AS rit_valor,
                 a."Nombre" AS area_nombre,
                 a.id_materia
            FROM "recomendacion_estandar" r
            JOIN "Estandar" e ON e.id_estandar = r.id_estandar
       LEFT JOIN "Tema"     t ON t.id_tema    = e.id_tema
       LEFT JOIN "Area"     a ON a.id_area    = t.id_area
           WHERE ${filtrosBase.join(" AND ")}
             ${id_materia ? "AND a.id_materia = $" + 2 : ""}
           ORDER BY r.vigente DESC, r.prioridad DESC, r.creado_en DESC, r.id_rec DESC`,
        params: id_materia ? [usuarioId, id_materia] : [usuarioId],
      },
      {
        // Fallbacks antiguos
        sql: `
          SELECT r.id_rec, r.carne_estudiante, r.id_estandar, r.motivo, r.fuente,
                 r.prioridad, r.vigente, r.creado_en,
                 NULL::text AS estandar_nombre, NULL::int AS rit_valor,
                 NULL::text AS area_nombre, NULL::int AS id_materia
            FROM "recomendacion_estandar" r
           WHERE ${filtrosBase.join(" AND ")}
           ORDER BY r.vigente DESC, r.prioridad DESC, r.creado_en DESC, r.id_rec DESC`,
        params: [usuarioId],
      },
    ]);

    const total = rows.length;
    const vig = rows.filter(r => r.vigente).length;

    return res.json({
      ok: true,
      resumen: { vigentes: vig, total },
      items: rows.map(r => ({
        id_estandar: r.id_estandar,
        motivo: r.motivo,
        fuente: r.fuente,
        prioridad: r.prioridad,
        vigente: r.vigente,
        creado_en: r.creado_en,
        estandar_nombre: r.estandar_nombre,
        rit_valor: r.rit_valor,
        area_nombre: r.area_nombre,
      })),
    });
  } catch (e) { next(e); }
}

// GET /api/evaluaciones/:id/participantes/:carne/recomendaciones?vigentes=1
router.get("/evaluaciones/:id/participantes/:carne/recomendaciones", recomendacionesPorSesionYCarne);
router.get("/evaluaciones/:id/participantes/:carne/estandares", recomendacionesPorSesionYCarne);

/* ============== Recomendaciones generales (opcional) ============== */
router.get("/recomendaciones/:carne", async (req, res, next) => {
  try {
    const carneParam = req.params.carne?.trim();
    if (!carneParam) return res.status(400).json({ ok:false, error:"bad_request" });

    const usuarioId = await toUserIdFromCarneOrId(carneParam);
    if (usuarioId == null) return res.json({ ok:true, resumen:{vigentes:0,total:0}, items: [] });

    const soloVigentes = asBoolOrNull(req.query.vigentes ?? "1");
    const id_materia = toInt(req.query.id_materia);

    const filtros = [`r.carne_estudiante = $1`];
    if (soloVigentes !== null) filtros.push(`r.vigente = ${soloVigentes ? "TRUE" : "FALSE"}`);

    const rows = await firstSuccessfulQuery([
      {
        sql: `
          SELECT r.id_rec, r.carne_estudiante, r.id_estandar, r.motivo, r.fuente,
                 r.prioridad, r.vigente, r.creado_en,
                 e."Nombre" AS estandar_nombre,
                 e."Valor"  AS rit_valor,
                 a."Nombre" AS area_nombre,
                 a.id_materia
            FROM "recomendacion_estandar" r
            JOIN "Estandar" e ON e.id_estandar = r.id_estandar
       LEFT JOIN "Tema"     t ON t.id_tema    = e.id_tema
       LEFT JOIN "Area"     a ON a.id_area    = t.id_area
           WHERE ${filtros.join(" AND ")}
             ${id_materia ? "AND a.id_materia = $" + 2 : ""}
           ORDER BY r.vigente DESC, r.prioridad DESC, r.creado_en DESC, r.id_rec DESC`,
        params: id_materia ? [usuarioId, id_materia] : [usuarioId],
      },
      {
        sql: `
          SELECT r.id_rec, r.carne_estudiante, r.id_estandar, r.motivo, r.fuente,
                 r.prioridad, r.vigente, r.creado_en,
                 NULL::text AS estandar_nombre, NULL::int AS rit_valor,
                 NULL::text AS area_nombre, NULL::int AS id_materia
            FROM "recomendacion_estandar" r
           WHERE ${filtros.join(" AND ")}
           ORDER BY r.vigente DESC, r.prioridad DESC, r.creado_en DESC, r.id_rec DESC`,
        params: [usuarioId],
      },
    ]);

    const total = rows.length;
    const vig = rows.filter(r => r.vigente).length;

    return res.json({
      ok: true,
      resumen: { vigentes: vig, total },
      items: rows.map(r => ({
        id_estandar: r.id_estandar,
        motivo: r.motivo,
        fuente: r.fuente,
        prioridad: r.prioridad,
        vigente: r.vigente,
        creado_en: r.creado_en,
        estandar_nombre: r.estandar_nombre,
        rit_valor: r.rit_valor,
        area_nombre: r.area_nombre,
        id_materia: r.id_materia,
      })),
    });
  } catch (e) { next(e); }
});

export default router;
