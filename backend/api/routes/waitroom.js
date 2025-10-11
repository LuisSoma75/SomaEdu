// backend/api/routes/waitroom.js
import express from "express";
import db from "../utils/db.js";

const router = express.Router();

/** Valida id numérico de sesión */
function parseSesionId(id) {
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Normaliza contadores por estado */
function normalizeCounts(rows = []) {
  const by = Object.fromEntries(rows.map((r) => [String(r.estado || ""), Number(r.c) || 0]));
  return {
    en_espera: by.en_espera || 0,
    activa: by.activa || 0,
    en_curso: by.en_curso || 0,
    finalizado: by.finalizado || 0,
    total: Object.values(by).reduce((a, b) => a + (Number(b) || 0), 0),
  };
}

/** GET /api/waitroom/:id/contadores  -> contadores por estado */
router.get("/:id/contadores", async (req, res, next) => {
  try {
    const id_sesion = parseSesionId(req.params.id);
    if (!id_sesion) {
      return res.status(400).json({ ok: false, error: "bad_request", message: "id de sesión inválido" });
    }
    const { rows } = await db.query(
      `SELECT estado, COUNT(*)::int AS c
         FROM "Sesion_participante"
        WHERE "id_sesion" = $1
        GROUP BY estado`,
      [id_sesion]
    );
    res.json({ ok: true, data: normalizeCounts(rows) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/waitroom/:id/participantes  -> lista básica para sala de espera */
router.get("/:id/participantes", async (req, res, next) => {
  try {
    const id_sesion = parseSesionId(req.params.id);
    if (!id_sesion) {
      return res.status(400).json({ ok: false, error: "bad_request", message: "id de sesión inválido" });
    }

    // 🔴 IMPORTANTE: nombre viene desde Usuarios."Nombre"
    const sql = `
      SELECT
        sp.id_estudiante,
        COALESCE(u."Nombre",'—') AS nombre,
        sp.estado,
        sp.joined_at
      FROM "Sesion_participante" sp
      LEFT JOIN "Estudiantes" e ON e."carne_estudiante" = sp."id_estudiante"
      LEFT JOIN "Usuarios"    u ON u."id_usuario"       = e."id_usuario"
      WHERE sp."id_sesion" = $1
      ORDER BY sp.joined_at ASC
    `;
    const { rows } = await db.query(sql, [id_sesion]);

    const items = rows.map((r) => ({
      id_estudiante: r.id_estudiante,
      nombre: r.nombre ?? "—",
      estado: r.estado || "",
      joined_at: r.joined_at || null,
    }));

    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

export default router;
