// backend/api/routes/estudiante/estudiante-evaluaciones.js
import express from "express";
import db from "../../utils/db.js";

const router = express.Router();

/**
 * GET /api/estudiante/evaluaciones
 *
 * Parámetros admitidos (cualquiera de los identificadores):
 *  - id_usuario | userId | carne | dpi | id_grado | grado_id
 *
 * Filtros opcionales:
 *  - estado (csv) ej: programada,en_espera,activa,finalizada
 *  - id_materia
 *  - desde, hasta  (YYYY-MM-DD)  -> se filtra por COALESCE(se.creado_en, se.iniciado_en)
 *  - page, size
 *
 * Respuesta:
 *  { ok:true, items:[...], data:[...], page, size }
 *
 * Notes:
 * - Normalizamos el shape para que el frontend pueda mapear:
 *   { id: id_sesion, titulo: nombre, grado: grado_nombre, materia: materia_nombre, ... }
 *   El propio frontend ya admite 'id' o 'id_sesion', etc., pero aquí dejamos datos claros.
 */
router.get("/", async (req, res, next) => {
  try {
    const {
      id_usuario,
      userId,
      carne,
      dpi,
      id_grado,
      grado_id,
      estado = "programada,en_espera,activa", // por defecto mostramos abiertas
      id_materia,
      desde,
      hasta,
      page = 1,
      size = 50,
    } = req.query;

    // ------------------ 1) Resolver el id_grado del alumno ------------------
    let gradoId = Number(id_grado ?? grado_id) || null;

    // Si no vino id_grado, buscamos en Estudiantes por cualquiera de los identificadores
    if (!gradoId) {
      const whereStu = [];
      const paramsStu = [];

      const _idUsuario = Number(id_usuario ?? userId) || null;
      const _carne = carne ? String(carne) : null;
      const _dpi = dpi ? String(dpi) : null;

      if (_idUsuario) {
        whereStu.push(`e.id_usuario = $${paramsStu.length + 1}`);
        paramsStu.push(_idUsuario);
      }
      if (_carne) {
        whereStu.push(`e.carne_estudiante = $${paramsStu.length + 1}`);
        paramsStu.push(_carne);
      }
      if (_dpi) {
        whereStu.push(`e.dpi = $${paramsStu.length + 1}`);
        paramsStu.push(_dpi);
      }

      if (!whereStu.length) {
        return res.status(400).json({
          ok: false,
          error: "missing_user",
          message:
            "Falta id_usuario/userId o carne o dpi, o id_grado/grado_id.",
        });
      }

      const sqlStu = `
        SELECT e.id_grado
        FROM "Estudiantes" e
        WHERE ${whereStu.join(" OR ")}
        LIMIT 1
      `;
      console.log("[SQL stu]", sqlStu.replace(/\s+/g, " ").trim(), "| params:", paramsStu);

      const rStu = await db.query(sqlStu, paramsStu);
      if (rStu.rows.length) {
        gradoId = Number(rStu.rows[0].id_grado);
      } else {
        // Alumno no encontrado -> devolvemos lista vacía (no es error)
        return res.json({
          ok: true,
          items: [],
          data: [],
          page: Number(page),
          size: Number(size),
        });
      }
    }

    // ------------------ 2) Filtros de sesiones ------------------
    const estados = String(estado)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const where = [`c.id_grado = $1`];
    const params = [gradoId];

    if (estados.length) {
      where.push(`se.estado = ANY($${params.length + 1})`);
      params.push(estados);
    }
    if (id_materia) {
      where.push(`c.id_materia = $${params.length + 1}`);
      params.push(Number(id_materia));
    }
    if (desde) {
      where.push(
        `COALESCE(se.creado_en, se.iniciado_en) >= $${params.length + 1}`
      );
      params.push(desde);
    }
    if (hasta) {
      where.push(
        `COALESCE(se.creado_en, se.iniciado_en) <= $${params.length + 1}`
      );
      params.push(hasta);
    }

    const limit = Math.max(1, Math.min(200, Number(size)));
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    const sql = `
      SELECT
        se.id_sesion,
        se.estado,
        se.iniciado_en,
        se.finalizado_en,
        se.pin,
        COALESCE(se.nombre, 'Sesión ' || se.id_sesion::text) AS nombre,
        c.id_clase,
        c.id_grado,
        c.id_materia,
        g."Nombre" AS grado_nombre,
        m."Nombre" AS materia_nombre
      FROM "Sesion_evaluacion" se
      JOIN "Clase"   c ON c.id_clase   = se.id_clase
      JOIN "Grado"   g ON g.id_grado   = c.id_grado
      JOIN "Materia" m ON m.id_materia = c.id_materia
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(se.creado_en, se.iniciado_en) DESC NULLS LAST, se.id_sesion DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    console.log("[SQL]", sql.replace(/\s+/g, " ").trim(), "| params:", params);
    const { rows } = await db.query(sql, params);

    // ------------------ 3) Normalizar al shape del frontend ------------------
    const items = rows.map((r) => ({
      // claves base (compat con frontend)
      id: Number(r.id_sesion),              // el front acepta id o id_sesion
      id_sesion: Number(r.id_sesion),
      titulo: r.nombre,
      nombre: r.nombre,
      estado: r.estado,                     // programada | en_espera | activa | finalizada
      fecha: r.iniciado_en || null,
      // clase/materia/grado
      id_clase: Number(r.id_clase),
      id_grado: Number(r.id_grado),
      id_materia: Number(r.id_materia),
      grado: r.grado_nombre ?? null,
      grado_nombre: r.grado_nombre ?? null,
      materia: r.materia_nombre ?? null,
      materia_nombre: r.materia_nombre ?? null,
      // otros
      pin: r.pin || null,
      iniciado_en: r.iniciado_en || null,
      finalizado_en: r.finalizado_en || null,

      // campos que usa la tabla (si existen num_preg_max/minutos en tu modelo, ajusta aquí)
      modalidad: "# Preguntas",
      minutos: null,
      num_preguntas: null,

      // extras útiles por si navegas con state a Resolver
      num_preg_max: 10, // cambia si lo tienes en BD
      docente: null,
    }));

    return res.json({
      ok: true,
      items,
      data: items,
      page: Number(page),
      size: limit,
    });
  } catch (err) {
    console.error("GET /api/estudiante/evaluaciones error:", err);
    next(err);
  }
});

export default router;
