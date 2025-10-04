import express from "express";
import db from "../utils/db.js";

const router = express.Router();

/**
 * GET /api/docente/evaluaciones
 * Query: estado (csv), creado_por_dpi, id_clase, id_grado, id_materia, desde, hasta, page, size
 * Opcional: id_usuario (si no usas JWT)
 */
router.get("/", async (req, res, next) => {
  try {
    const {
      estado = "",
      creado_por_dpi,
      id_clase,
      id_grado,
      id_materia,
      desde,
      hasta,
      page = 1,
      size = 50,
      id_usuario, // opcional por query si no tienes req.user
    } = req.query;

    // --- Docente/usuario desde JWT o query ---
    const usuarioId = Number(req.user?.id_usuario ?? id_usuario) || null;

    // --- Filtros ---
    const estados = String(estado).split(",").map(s => s.trim()).filter(Boolean);
    const where = [];
    const params = [];

    if (estados.length) {
      where.push(`se.estado = ANY($${params.length + 1})`);
      params.push(estados);
    }
    if (creado_por_dpi) {
      where.push(`se.creado_por_dpi = $${params.length + 1}`);
      params.push(creado_por_dpi);
    }
    if (id_clase) {
      where.push(`c.id_clase = $${params.length + 1}`);
      params.push(Number(id_clase));
    }
    if (id_grado) {
      where.push(`g.id_grado = $${params.length + 1}`);
      params.push(Number(id_grado));
    }
    if (id_materia) {
      where.push(`m.id_materia = $${params.length + 1}`);
      params.push(Number(id_materia));
    }
    if (desde) {
      where.push(`COALESCE(se.creado_en, se.iniciado_en) >= $${params.length + 1}`);
      params.push(desde);
    }
    if (hasta) {
      where.push(`COALESCE(se.creado_en, se.iniciado_en) <= $${params.length + 1}`);
      params.push(hasta);
    }

    // --- JOINs base ---
    const joins = [
      `JOIN "Clase"   c ON c.id_clase   = se.id_clase`,
      `JOIN "Grado"   g ON g.id_grado   = c.id_grado`,
      `JOIN "Materia" m ON m.id_materia = c.id_materia`,
    ];

    // --- Filtrado por docente (como en /docente/clases/:id) ---
    if (usuarioId) {
      joins.push(
        `JOIN "Docente_Clase" dc ON dc.id_clase = c.id_clase`,
        `JOIN "Docentes" d ON dc.dpi = d.dpi`
      );
      where.push(`d.id_usuario = $${params.length + 1}`);
      params.push(usuarioId);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // --- Paginación ---
    const limit = Math.max(1, Math.min(200, Number(size)));
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    // --- Consulta (sin columnas inexistentes) ---
    const sql = `
      SELECT
        se.id_sesion,
        se.estado,
        se.iniciado_en,
        se.finalizado_en,
        se.pin,
        COALESCE(se.nombre, 'Sesión ' || se.id_sesion::text) AS se_nombre,
        se.id_clase,
        c.id_clase     AS clase_id,
        g.id_grado     AS grado_id,
        m.id_materia   AS materia_id,
        g."Nombre"     AS grado_nombre,
        m."Nombre"     AS materia_nombre
      FROM "Sesion_evaluacion" se
      ${joins.join("\n")}
      ${whereSql}
      ORDER BY COALESCE(se.creado_en, se.iniciado_en) DESC NULLS LAST, se.id_sesion DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const { rows } = await db.query(sql, params);

    const data = rows.map(r => ({
      id_sesion: Number(r.id_sesion),
      nombre: r.se_nombre ?? `Sesión ${Number(r.id_sesion)}`,
      estado: r.estado,
      iniciado_en: r.iniciado_en || null,
      finalizado_en: r.finalizado_en || null,
      pin: r.pin || null,
      id_clase: Number(r.clase_id ?? r.id_clase),
      id_grado: Number(r.grado_id),
      id_materia: Number(r.materia_id),
      grado_nombre: r.grado_nombre ?? null,
      materia_nombre: r.materia_nombre ?? null,
    }));

    res.json({ ok: true, data, items: data, page: Number(page), size: limit });
  } catch (err) {
    console.error("GET /api/docente/evaluaciones error:", err);
    next(err);
  }
});

export default router;
