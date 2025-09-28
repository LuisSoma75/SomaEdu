// backend/api/routes/waitroom.js
import express from "express";
import db from "../utils/db.js";

const router = express.Router();

/** Util simple para validar id_sesion numérico */
function parseSesionId(id) {
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Normaliza la forma de respuesta de contadores */
function normalizeCounts(rows = []) {
  const by = Object.fromEntries(rows.map((r) => [r.estado, Number(r.c) || 0]));
  return {
    en_espera: by["en_espera"] || 0,
    listo: by["listo"] || 0,
    en_curso: by["en_curso"] || 0,
    finalizado: by["finalizado"] || 0,
  };
}

/**
 * GET /api/waitroom/:id_sesion/state
 * Estado de la sala + contadores por estado
 */
router.get("/:id_sesion/state", async (req, res, next) => {
  try {
    const sid = parseSesionId(req.params.id_sesion);
    if (!sid) return res.status(400).json({ ok: false, error: "id_sesion_invalido" });

    const ses = await db.query(
      `SELECT "id_sesion","estado","iniciado_en"
         FROM "Sesion_evaluacion"
        WHERE "id_sesion"=$1`,
      [sid]
    );
    if (ses.rowCount === 0) return res.status(404).json({ ok: false, error: "sesion_no_encontrada" });

    const counts = await db.query(
      `SELECT estado, COUNT(*)::int AS c
         FROM "Sesion_participante"
        WHERE "id_sesion"=$1
        GROUP BY estado`,
      [sid]
    );

    return res.json({
      ok: true,
      id_sesion: sid,
      estado: ses.rows[0].estado || "en_espera",
      participantes: normalizeCounts(counts.rows),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/waitroom/:id_sesion/participants
 * Lista de participantes (para tabla en Monitoreo)
 */
router.get("/:id_sesion/participants", async (req, res, next) => {
  try {
    const sid = parseSesionId(req.params.id_sesion);
    if (!sid) return res.status(400).json({ ok: false, error: "id_sesion_invalido" });

    // Opcional: validar que la sesión exista
    const ses = await db.query(
      `SELECT 1 FROM "Sesion_evaluacion" WHERE "id_sesion"=$1`,
      [sid]
    );
    if (ses.rowCount === 0) return res.status(404).json({ ok: false, error: "sesion_no_encontrada" });

    const q = await db.query(
      `SELECT sp.id_estudiante,
              COALESCE(e.nombres || ' ' || e.apellidos, e.nombres, '—') AS nombre,
              sp.estado,
              sp.joined_at
         FROM "Sesion_participante" sp
    LEFT JOIN "Estudiante" e
           ON e."id_estudiante" = sp."id_estudiante"
        WHERE sp."id_sesion" = $1
        ORDER BY sp.joined_at ASC`,
      [sid]
    );

    return res.json({ ok: true, items: q.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/waitroom/:id_sesion/join
 * Estudiante entra a la sala:
 *  - si la sesión está ACTIVA => estado = 'en_curso'
 *  - si la sesión está PROGRAMADA => mueve la sesión a 'en_espera'
 */
router.post("/:id_sesion/join", async (req, res, next) => {
  try {
    const sid = parseSesionId(req.params.id_sesion);
    if (!sid) return res.status(400).json({ ok: false, error: "id_sesion_invalido" });

    const { id_estudiante } = req.body || {};
    if (!Number.isFinite(Number(id_estudiante))) {
      return res.status(400).json({ ok: false, error: "missing_id_estudiante" });
    }

    // Lee estado actual de la sesión
    const s = await db.query(
      `SELECT "estado" FROM "Sesion_evaluacion" WHERE "id_sesion"=$1`,
      [sid]
    );
    if (s.rowCount === 0) return res.status(404).json({ ok: false, error: "sesion_no_encontrada" });

    const estadoSesion = s.rows[0].estado;
    const destino = estadoSesion === "activa" ? "en_curso" : "en_espera";

    // Upsert participante
    await db.query(
      `INSERT INTO "Sesion_participante" ("id_sesion","id_estudiante","estado")
       VALUES ($1,$2,$3)
       ON CONFLICT ("id_sesion","id_estudiante")
       DO UPDATE SET "estado"=$3,"last_ping"=now()`,
      [sid, Number(id_estudiante), destino]
    );

    // Si estaba programada, al primer join pasa a en_espera
    if (estadoSesion === "programada") {
      await db.query(
        `UPDATE "Sesion_evaluacion"
            SET "estado"='en_espera'
          WHERE "id_sesion"=$1 AND "estado"='programada'`,
        [sid]
      );
    }

    return res.json({ ok: true, estado_participante: destino });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/waitroom/:id_sesion/start
 * Docente inicia: sesión => 'activa', participantes en ('en_espera','listo') => 'en_curso'
 */
router.post("/:id_sesion/start", async (req, res, next) => {
  try {
    const sid = parseSesionId(req.params.id_sesion);
    if (!sid) return res.status(400).json({ ok: false, error: "id_sesion_invalido" });

    // Verifica existencia
    const ses = await db.query(
      `SELECT 1 FROM "Sesion_evaluacion" WHERE "id_sesion"=$1`,
      [sid]
    );
    if (ses.rowCount === 0) return res.status(404).json({ ok: false, error: "sesion_no_encontrada" });

    // Cambia estado de sesión
    await db.query(
      `UPDATE "Sesion_evaluacion"
          SET "estado"='activa',"iniciado_en"=now()
        WHERE "id_sesion"=$1`,
      [sid]
    );

    // Pasa participantes a en_curso
    await db.query(
      `UPDATE "Sesion_participante"
          SET "estado"='en_curso'
        WHERE "id_sesion"=$1 AND "estado" IN ('en_espera','listo')`,
      [sid]
    );

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
