// backend/api/routes/estudiante/historial.js
import express from "express";
import db from "../../utils/db.js";

const router = express.Router();

/**
 * GET /api/estudiante/historial
 *
 * Identificadores admitidos (cualquiera):
 *  - id_usuario | userId | carne | dpi
 *
 * Filtros opcionales:
 *  - desde, hasta  (YYYY-MM-DD)  -> filtra por COALESCE(se.finalizado_en, se.iniciado_en, se.creado_en)
 *  - page, size
 *
 * Respuesta:
 *  { ok:true, items:[{ id, titulo, fecha, estado, puntaje, tiempo, intento }], page, size }
 */
router.get("/", async (req, res, next) => {
  try {
    let { id_usuario, userId, carne, dpi, desde, hasta, page = 1, size = 20 } = req.query;
    id_usuario = id_usuario ?? userId ?? null;
    carne = carne ?? null;
    dpi = dpi ?? null;
    page = Math.max(1, Number(page) || 1);
    size = Math.min(200, Math.max(1, Number(size) || 20));

    // Si no viene carne, resolverlo desde id_usuario (o dpi si lo usas para mapear correo/DPI)
    if (!carne && (id_usuario || dpi)) {
      const { rows } = await db.query(
        `SELECT e.carne_estudiante AS carne
           FROM "Estudiantes" e
           JOIN "Usuarios" u ON u.id_usuario = e.id_usuario
          WHERE ($1::int IS NULL OR u.id_usuario = $1::int)
             OR ($2::text IS NULL OR u.correo = $2::text)`,
        [id_usuario ? Number(id_usuario) : null, dpi || null]
      );
      carne = rows[0]?.carne ?? null;
    }

    if (!carne) {
      return res.status(400).json({
        ok: false,
        error: "bad_request",
        message: "Falta el identificador del estudiante (carne o id_usuario).",
      });
    }

    const where = [`sp.id_estudiante = $1`, `COALESCE(sp.estado,'') <> 'en_espera'`];
    const params = [Number(carne)];

    if (desde) {
      where.push(`COALESCE(se.finalizado_en, se.iniciado_en, se.creado_en) >= $${params.length + 1}`);
      params.push(desde);
    }
    if (hasta) {
      where.push(`COALESCE(se.finalizado_en, se.iniciado_en, se.creado_en) <= $${params.length + 1}`);
      params.push(hasta);
    }

    const offset = (page - 1) * size;

    const sql = `
      SELECT
        se.id_sesion AS id,
        se.nombre    AS titulo,
        COALESCE(se.finalizado_en, se.iniciado_en, se.creado_en) AS fecha,
        CASE
          WHEN se.finalizado_en IS NOT NULL THEN 'finalizado'
          WHEN se.iniciado_en  IS NOT NULL THEN 'en_curso'
          ELSE COALESCE(NULLIF(sp.estado, ''), se.estado)
        END AS estado,
        EXTRACT(EPOCH FROM (se.finalizado_en - se.iniciado_en)) AS segs,
        1 AS intento
      FROM "Sesion_evaluacion" se
      JOIN "Sesion_participante" sp ON sp.id_sesion = se.id_sesion
      WHERE ${where.join(" AND ")}
      ORDER BY fecha DESC NULLS LAST
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const { rows } = await db.query(sql, params.concat([size, offset]));

    const items = rows.map((r) => ({
      id: Number(r.id),
      titulo: r.titulo || "Evaluación",
      fecha: r.fecha,
      estado: r.estado || "finalizado",
      puntaje: null, // si luego guardan nota por alumno, mapéala aquí
      tiempo: Number.isFinite(r.segs) && r.segs >= 0 ? secsToHHMMSS(r.segs) : null,
      intento: r.intento || 1,
    }));

    res.json({ ok: true, items, page, size });
  } catch (err) {
    next(err);
  }
});

function secsToHHMMSS(secs) {
  const s = Math.floor(Number(secs) || 0);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}

export default router;
