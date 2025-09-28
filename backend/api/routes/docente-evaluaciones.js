// backend/api/routes/docente-evaluaciones.js
import express from "express";
import db from "../utils/db.js"; // pool/query (ESM)

const router = express.Router();

/**
 * GET /api/docente/evaluaciones
 *
 * Querystring opcional:
 *  - estado: lista separada por coma (p. ej. programada,en_espera,activa,finalizada)
 *  - creado_por_dpi
 *  - id_clase, id_grado, id_materia
 *  - desde, hasta  (YYYY-MM-DD)  -> filtra por se.creado_en
 *  - page (>=1), size (1..200)
 *
 * Respuesta:
 *  {
 *    ok: true,
 *    data: [{ id_sesion, nombre, estado, iniciado_en, finalizado_en, pin, id_clase, id_grado, id_materia, grado_nombre, materia_nombre }],
 *    items: [...misma data...],   // por compatibilidad con código previo
 *    page, size
 *  }
 */
router.get("/", async (req, res, next) => {
  try {
    const {
      estado = "",           // puede venir “a,b,c”
      creado_por_dpi,
      id_clase,
      id_grado,
      id_materia,
      desde,
      hasta,
      page = 1,
      size = 50,
    } = req.query;

    // --------- Filtros ---------
    const estados = String(estado)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean); // si está vacío, no filtra por estado

    const where = [];
    const params = [];

    if (estados.length) {
      where.push(`se."estado" = ANY($${params.length + 1})`);
      params.push(estados);
    }
    if (creado_por_dpi) {
      where.push(`se."creado_por_dpi" = $${params.length + 1}`);
      params.push(creado_por_dpi);
    }
    if (id_clase) {
      where.push(`c."id_clase" = $${params.length + 1}`);
      params.push(Number(id_clase));
    }
    if (id_grado) {
      where.push(`g."id_grado" = $${params.length + 1}`);
      params.push(Number(id_grado));
    }
    if (id_materia) {
      where.push(`m."id_materia" = $${params.length + 1}`);
      params.push(Number(id_materia));
    }
    if (desde) {
      where.push(`se."creado_en" >= $${params.length + 1}`);
      params.push(desde);
    }
    if (hasta) {
      where.push(`se."creado_en" <= $${params.length + 1}`);
      params.push(hasta);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // --------- Paginación ---------
    const limit = Math.max(1, Math.min(200, Number(size)));
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    // --------- Consulta ---------
    // NOTAS:
    // - Si tu esquema usa otros nombres de columnas (por ejemplo "nombre" en Grado/Materia),
    //   ajusta los alias "grado_nombre" y "materia_nombre".
    // - Si "Sesion_evaluacion" no tiene columna "nombre", quedará NULL y se usará fallback.
    const sql = `
      SELECT
        se."id_sesion",
        se."estado",
        se."iniciado_en",
        se."finalizado_en",
        se."pin",
        se."nombre"                                   AS se_nombre,   -- puede ser NULL si no existe en tu esquema
        se."id_clase",
        c."id_clase"                                  AS clase_id,
        g."id_grado"                                  AS grado_id,
        m."id_materia"                                AS materia_id,
        -- Ajusta estos nombres si en tu schema son distintos:
        g."Nombre"                                    AS grado_nombre,
        m."Nombre"                                    AS materia_nombre
      FROM "Sesion_evaluacion" se
      JOIN "Clase"   c ON c."id_clase"    = se."id_clase"
      JOIN "Grado"   g ON g."id_grado"    = c."id_grado"
      JOIN "Materia" m ON m."id_materia"  = c."id_materia"
      ${whereSql}
      ORDER BY se."creado_en" DESC NULLS LAST, se."id_sesion" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const { rows } = await db.query(sql, params);

    // --------- Normalización ---------
    const data = rows.map((r) => ({
      id_sesion: Number(r.id_sesion),
      // Si no hay nombre en la tabla, se crea un alias amigable:
      nombre: r.se_nombre ?? `Sesión ${Number(r.id_sesion)}`,
      estado: r.estado, // puede ser programada | en_espera | activa | finalizada (o tus valores heredados)
      iniciado_en: r.iniciado_en || null,
      finalizado_en: r.finalizado_en || null,
      pin: r.pin || null,

      id_clase: Number(r.clase_id ?? r.id_clase),
      id_grado: Number(r.grado_id),
      id_materia: Number(r.materia_id),

      grado_nombre: r.grado_nombre ?? null,
      materia_nombre: r.materia_nombre ?? null,
    }));

    // Respuesta compatible (data + items)
    res.json({
      ok: true,
      data,
      items: data, // compat con frontend anterior
      page: Number(page),
      size: limit,
    });
  } catch (err) {
    console.error("GET /api/docente/evaluaciones error:", err);
    next(err);
  }
});

export default router;
