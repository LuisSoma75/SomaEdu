// backend/api/routes/sesiones.js
import express from "express";
import db from "../utils/db.js";

const router = express.Router();

/*
  Crea una sesión general (Sesion_evaluacion).
  Body esperado:
    - nombre (string, requerido)
    - id_clase (int, requerido)
    - creado_por_dpi (string, opcional)  // si no llega, se intenta resolver con id_usuario
    - id_usuario (int, opcional)
    - modalidad: 'num_preguntas' | 'tiempo' | 'hasta_detener' (opcional)
    - num_preg_max (int, requerido si modalidad = 'num_preguntas')
    - minutos (int, requerido si modalidad = 'tiempo')
    - modo_adaptativo (bool, opcional)
*/
router.post("/", async (req, res, next) => {
  try {
    const {
      nombre,
      id_clase,
      creado_por_dpi,
      id_usuario,
      modalidad,
      num_preg_max,
      minutos,
      modo_adaptativo,
    } = req.body;

    if (!nombre || !id_clase) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    // 1) Resolver DPI del docente
    let dpi = (creado_por_dpi || "").trim();
    if (!dpi && id_usuario) {
      // Intenta obtener el DPI desde la tabla Docentes por id_usuario
      const q = await db.query(
        `SELECT d."dpi" FROM "Docentes" d WHERE d."id_usuario" = $1 LIMIT 1;`,
        [Number(id_usuario)]
      );
      dpi = q.rows?.[0]?.dpi || "";
    }
    if (!dpi) {
      return res.status(400).json({
        ok: false,
        error: "dpi_required",
        msg: "No se pudo determinar el DPI del docente (envía creado_por_dpi o id_usuario).",
      });
    }

    // 2) Normalizar configuración según modalidad
    let numPreg = null;
    let tSeg = null;
    const mod =
      modalidad || (minutos ? "tiempo" : num_preg_max ? "num_preguntas" : "hasta_detener");

    if (mod === "num_preguntas") {
      if (!num_preg_max) {
        return res.status(400).json({ ok: false, error: "num_preg_max_required" });
      }
      numPreg = Number(num_preg_max);
    } else if (mod === "tiempo") {
      if (!minutos) {
        return res.status(400).json({ ok: false, error: "minutos_required" });
      }
      tSeg = Number(minutos) * 60;
    }

    // 3) Insert
    const ins = await db.query(
      `
      INSERT INTO "Sesion_evaluacion"
        ("id_clase","creado_por_dpi","modo_adaptativo","num_preg_max","tiempo_limite_seg","estado","creado_en","nombre")
      VALUES ($1,$2,$3,$4,$5,'programada', NOW(), $6)
      RETURNING "id_sesion","estado","creado_en";
    `,
      [Number(id_clase), dpi, !!modo_adaptativo, numPreg, tSeg, nombre]
    );

    const row = ins.rows[0];
    res.json({
      ok: true,
      id_sesion: Number(row.id_sesion),
      estado: row.estado,
      creado_en: row.creado_en,
    });
  } catch (err) {
    console.error("POST /api/sesiones error:", err);
    next(err);
  }
});

export default router;
