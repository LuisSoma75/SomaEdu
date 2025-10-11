// ESM router que importa controller CJS correcto y añade diagnósticos
import { Router } from "express";

// ⚠️ CJS interop seguro
import ctrlNs from "../controllers/adaptativeController.cjs";
const ctrl = ctrlNs?.default && typeof ctrlNs.default === "object" ? ctrlNs.default : ctrlNs;

// Verificación de exports
const {
  startSession,
  submitAnswer,
  endSession,
  areasByEvaluacion,
} = ctrl;

// DB para diagnósticos
import dbNs from "../utils/db.cjs";
const db = dbNs?.default ?? dbNs;

const router = Router();

// ====== Rutas principales ======
router.post("/session/start", (req, res, next) => {
  console.log("[RT ADAPT] /session/start user=", req.user?.id_usuario, "body=", req.body);
  return startSession(req, res, next);
});

router.post("/session/:id/answer", (req, res, next) => {
  console.log("[RT ADAPT] /session/:id/answer id=", req.params?.id);
  return submitAnswer(req, res, next);
});

router.post("/session/:id/end", (req, res, next) => {
  console.log("[RT ADAPT] /session/:id/end id=", req.params?.id);
  return endSession(req, res, next);
});

router.get("/evaluaciones/:id/areas", (req, res, next) => {
  console.log("[RT ADAPT] /evaluaciones/:id/areas id=", req.params?.id);
  return areasByEvaluacion(req, res, next);
});

// ====== DIAGNÓSTICOS ======

// 1) ¿Qué DB estoy usando?
router.get("/__diag/db", async (_req, res) => {
  try {
    const q = `
      SELECT current_database() AS db,
             current_user      AS "user",
             inet_server_addr()::text AS host,
             inet_server_port()       AS port
    `;
    const { rows } = await db.query(q);
    res.json({ ok: true, env_db: rows[0] });
  } catch (e) {
    console.error("[ADAPTIVE DIAG] db", e);
    res.status(500).json({ ok: false, msg: e.message });
  }
});

// 2) ¿Cuáles columnas NOT NULL pueden estar bloqueando INSERT en Evaluacion/Matricula?
router.get("/__diag/schema", async (_req, res) => {
  try {
    const q = (t) => `
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='${t}'
      ORDER BY ordinal_position
    `;
    const [ev, mat] = await Promise.all([
      db.query(q("Evaluacion")),
      db.query(q("Matricula"))
    ]);
    res.json({ ok: true, Evaluacion: ev.rows, Matricula: mat.rows });
  } catch (e) {
    console.error("[ADAPTIVE DIAG] schema", e);
    res.status(500).json({ ok: false, msg: e.message });
  }
});

// 3) Fuerza una escritura mínima en recomendacion_estandar (para aislar permisos/DB)
router.post("/__diag/force-reco", async (req, res) => {
  const carne = String(req.body?.carne ?? "").trim();
  const id_estandar = Number(req.body?.id_estandar);
  const prioridad = Number(req.body?.prioridad ?? 1);
  if (!carne || !Number.isFinite(id_estandar)) {
    return res.status(400).json({ ok: false, msg: "carne e id_estandar requeridos" });
  }
  try {
    // asegura índice único si no existe (no falla si ya está)
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname='public' AND indexname='ux_reco_civ'
        ) THEN
          CREATE UNIQUE INDEX ux_reco_civ
          ON "recomendacion_estandar" ("carne_estudiante","id_estandar","vigente");
        END IF;
      END
      $$;
    `);

    const { rows } = await db.query(
      `
      INSERT INTO "recomendacion_estandar"
        ("carne_estudiante","id_estandar","motivo","fuente","prioridad","creado_en","vigente")
      VALUES ($1,$2,'diag','diag', $3, NOW(), TRUE)
      ON CONFLICT ("carne_estudiante","id_estandar","vigente")
      DO UPDATE SET "prioridad" = "recomendacion_estandar"."prioridad" + EXCLUDED."prioridad"
      RETURNING *
      `,
      [carne, id_estandar, prioridad]
    );

    const cnt = await db.query(
      `SELECT COUNT(*)::int AS c FROM "recomendacion_estandar" WHERE BTRIM("carne_estudiante"::text)=BTRIM($1::text)`,
      [carne]
    );

    res.json({ ok: true, row: rows[0], count_for_carne: cnt.rows[0]?.c ?? 0 });
  } catch (e) {
    console.error("[ADAPTIVE DIAG] force-reco", e);
    res.status(500).json({ ok: false, msg: e.message });
  }
});

export default router;
