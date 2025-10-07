// backend/api/routes/estudiante/notas-areas.js
import express from "express";
import { computeAreaScores } from "../../services/area-scores.js";

const router = express.Router();

/**
 * GET /api/estudiante/notas-areas
 * Query:
 *   - evaluacionId | id_evaluacion (opcional pero recomendado para "la evaluación actual")
 *   - carne=...            (opcional si pasas evaluacionId)
 *   - id_estudiante=...    (opcional si pasas evaluacionId)
 *   - desde=YYYY-MM-DD     (opcional)
 *   - hasta=YYYY-MM-DD     (opcional)
 */
router.get("/", async (req, res) => {
  try {
    const evaluacionId = req.query.evaluacionId ?? req.query.id_evaluacion ?? null;
    const carne = req.query.carne ?? req.query.carnet ?? null;
    const id_estudiante = req.query.id_estudiante ?? req.query.userId ?? null;
    const desde = req.query.desde ?? null;
    const hasta = req.query.hasta ?? null;

    if (!evaluacionId && !carne && !id_estudiante) {
      return res.status(400).json({ ok: false, msg: "Falta ?evaluacionId=... o (carne/id_estudiante)" });
    }

    const items = await computeAreaScores({ evaluacionId, carne, id_estudiante, desde, hasta });
    return res.json({ ok: true, items });
  } catch (e) {
    console.error("[notas-areas] error:", e);
    res.status(500).json({ ok: false, msg: e.message || "Error calculando notas por área" });
  }
});

export default router;
