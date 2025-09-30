// backend/api/routes/waitroom.js
import express from "express";
import db from "../utils/db.js";

const router = express.Router();

/** Ventana para considerar “conectado” (segundos) */
const WINDOW_SECONDS = 45;

/** Util simple para validar id_sesion numérico */
function parseSesionId(id) {
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Normaliza la forma de respuesta de contadores (en línea) */
function normalizeCounts(rows = []) {
  const by = Object.fromEntries(rows.map((r) => [r.estado, Number(r.c) || 0]));
  return {
    en_espera: by["en_espera"] || 0,
    listos: by["listo"] || by["listos"] || 0, // soporta singular/plural en DB
    en_curso: by["en_curso"] || 0,
    finalizados: by["finalizado"] || by["finalizados"] || 0,
  };
}

/** ---- Helpers SQL reutilizables ---- */

async function getSesionById(id_sesion) {
  const q = await db.query(
    `SELECT "id_sesion","codigo","estado","iniciado_en"
       FROM "Sesion_evaluacion"
      WHERE "id_sesion"=$1
      LIMIT 1`,
    [id_sesion]
  );
  return q.rows[0] || null;
}

async function getOnlineCounts(id_sesion) {
  // Cuenta SOLO participantes conectados en la ventana (last_ping reciente),
  // excluyendo “retirado” del total
  const q = await db.query(
    `WITH online AS (
       SELECT estado
         FROM "Sesion_participante"
        WHERE "id_sesion"=$1
          AND "last_ping" >= now() - make_interval(secs => $2)
          AND estado <> 'retirado'
     )
     SELECT estado, COUNT(*)::int AS c
       FROM online
      GROUP BY estado`,
    [id_sesion, WINDOW_SECONDS]
  );
  const counts = normalizeCounts(q.rows);
  const conectados =
    counts.en_espera + counts.listos + counts.en_curso + counts.finalizados;
  return { ...counts, conectados };
}

/** ---------- ENDPOINTS ---------- */

/**
 * GET /api/waitroom/:id_sesion/state
 * Estado de la sesión + contadores EN LÍNEA (ventana)
 */
router.get("/:id_sesion/state", async (req, res, next) => {
  try {
    const sid = parseSesionId(req.params.id_sesion);
    if (!sid) return res.status(400).json({ ok: false, error: "id_sesion_invalido" });

    const ses = await getSesionById(sid);
    if (!ses) return res.status(404).json({ ok: false, error: "sesion_no_encontrada" });

    const participantes = await getOnlineCounts(sid);

    return res.json({
      ok: true,
      id_sesion: sid,
      estado: ses.estado, // programada | en_espera | activa | finalizada (según tu flujo)
      participantes,      // { en_espera, listos, en_curso, finalizados, conectados }
      window_seconds: WINDOW_SECONDS,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/waitroom/:id_sesion/participants
 * Lista de participantes (todos los que han entrado), ordenados por joined_at
 */
router.get("/:id_sesion/participants", async (req, res, next) => {
  try {
    const sid = parseSesionId(req.params.id_sesion);
    if (!sid) return res.status(400).json({ ok: false, error: "id_sesion_invalido" });

    const ses = await getSesionById(sid);
    if (!ses) return res.status(404).json({ ok: false, error: "sesion_no_encontrada" });

    const q = await db.query(
      `SELECT sp.id_estudiante,
              COALESCE(e.nombres || ' ' || e.apellidos, e.nombres, '—') AS nombre,
              sp.estado,
              sp.joined_at,
              sp.last_ping
         FROM "Sesion_participante" sp
    LEFT JOIN "Estudiante" e
           ON e."id_estudiante" = sp."id_estudiante"
        WHERE sp."id_sesion" = $1
        ORDER BY sp.joined_at ASC, sp.id_estudiante ASC`,
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
 *  - si sesión 'activa' => estado_participante = 'en_curso'
 *  - si 'programada'    => la sesión pasa a 'en_espera' y el estudiante queda 'en_espera'
 *  - si 'en_espera'     => queda 'en_espera'
 * Marca joined_at (si es nuevo) y actualiza last_ping.
 */
router.post("/:id_sesion/join", async (req, res, next) => {
  try {
    const sid = parseSesionId(req.params.id_sesion);
    if (!sid) return res.status(400).json({ ok: false, error: "id_sesion_invalido" });

    const { id_estudiante } = req.body || {};
    const idEst = Number(id_estudiante);
    if (!Number.isFinite(idEst)) {
      return res.status(400).json({ ok: false, error: "missing_id_estudiante" });
    }

    const ses = await getSesionById(sid);
    if (!ses) return res.status(404).json({ ok: false, error: "sesion_no_encontrada" });

    let destino = "en_espera";
    if (ses.estado === "activa") destino = "en_curso";

    // Upsert participante (si existe, no tocar joined_at; solo last_ping y estado)
    await db.query(
      `INSERT INTO "Sesion_participante" ("id_sesion","id_estudiante","estado","joined_at","last_ping")
       VALUES ($1,$2,$3, now(), now())
       ON CONFLICT ("id_sesion","id_estudiante")
       DO UPDATE SET "estado"=$3, "last_ping"=now()`,
      [sid, idEst, destino]
    );

    // Si la sesión estaba programada, al primer join pasa a 'en_espera'
    if (ses.estado === "programada") {
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
 * PATCH /api/waitroom/:id_sesion/ping
 * Mantiene presencia del estudiante (y opcionalmente cambia su estado).
 * body: { id_estudiante, estado? }
 */
router.patch("/:id_sesion/ping", async (req, res, next) => {
  try {
    const sid = parseSesionId(req.params.id_sesion);
    if (!sid) return res.status(400).json({ ok: false, error: "id_sesion_invalido" });

    const { id_estudiante, estado = null } = req.body || {};
    const idEst = Number(id_estudiante);
    if (!Number.isFinite(idEst)) {
      return res.status(400).json({ ok: false, error: "missing_id_estudiante" });
    }

    // Actualiza last_ping y, si viene, estado
    await db.query(
      `UPDATE "Sesion_participante"
          SET "last_ping" = now(),
              "estado"    = COALESCE($3, "estado")
        WHERE "id_sesion" = $1
          AND "id_estudiante" = $2`,
      [sid, idEst, estado]
    );

    // Devuelve estado de la sesión para que el front pueda redirigir si inicia
    const ses = await getSesionById(sid);

    return res.json({ ok: true, sesion_estado: ses?.estado || null });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/waitroom/:id_sesion/start
 * Docente inicia: sesión => 'activa'
 * Participantes en ('en_espera','listo') => 'en_curso'
 * Marca "iniciado_en"=now()
 */
router.post("/:id_sesion/start", async (req, res, next) => {
  try {
    const sid = parseSesionId(req.params.id_sesion);
    if (!sid) return res.status(400).json({ ok: false, error: "id_sesion_invalido" });

    const ses = await getSesionById(sid);
    if (!ses) return res.status(404).json({ ok: false, error: "sesion_no_encontrada" });

    await db.query(
      `UPDATE "Sesion_evaluacion"
          SET "estado"='activa', "iniciado_en"=now()
        WHERE "id_sesion"=$1`,
      [sid]
    );

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

/**
 * GET /api/waitroom/:id_sesion/metrics
 * (alias de /state con formato directo de contadores)
 */
router.get("/:id_sesion/metrics", async (req, res, next) => {
  try {
    const sid = parseSesionId(req.params.id_sesion);
    if (!sid) return res.status(400).json({ ok: false, error: "id_sesion_invalido" });

    const ses = await getSesionById(sid);
    if (!ses) return res.status(404).json({ ok: false, error: "sesion_no_encontrada" });

    const counts = await getOnlineCounts(sid);

    return res.json({
      ok: true,
      counts,                 // { en_espera, listos, en_curso, finalizados, conectados }
      sesion_estado: ses.estado,
      window_seconds: WINDOW_SECONDS,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
