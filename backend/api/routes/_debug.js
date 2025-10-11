// backend/api/routes/_debug.js
import express from "express";
import db from "../utils/db.js";

const router = express.Router();
const TAG = "[DEBUG]";

/** Utilidades */
const safe = (v) => (v === undefined ? null : v);

router.get("/db", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         current_database() AS db,
         current_user       AS usr,
         inet_server_addr() AS host,
         inet_server_port() AS port,
         current_setting('search_path', true) AS search_path,
         current_setting('server_version', true) AS pg,
         NOW() AS now`
    );
    console.log(TAG, "DB INFO =", rows[0]);
    res.json({ ok: true, info: rows[0] });
  } catch (e) {
    console.error(TAG, "db error", e);
    res.status(500).json({ ok: false, msg: e.message });
  }
});

/** Todas las filas (máx 100) para ver si la tabla realmente tiene datos */
router.get("/reco/all", async (_req, res) => {
  try {
    const { rows: total } = await db.query(`SELECT COUNT(*)::int AS c FROM "recomendacion_estandar"`);
    const { rows } = await db.query(
      `SELECT *
         FROM "recomendacion_estandar"
        ORDER BY COALESCE("creado_en",'1970-01-01'::timestamp) DESC
        LIMIT 100`
    );
    console.log(TAG, `reco/all total=${total?.[0]?.c} first=${rows.length}`);
    res.json({ ok: true, total: total?.[0]?.c ?? 0, items: rows });
  } catch (e) {
    console.error(TAG, "reco/all error", e);
    res.status(500).json({ ok: false, msg: e.message });
  }
});

/** Carnés distintos presentes en la tabla (top 50) */
router.get("/reco/carnes", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT BTRIM(("carne_estudiante")::text) AS carne, COUNT(*)::int AS c
         FROM "recomendacion_estandar"
        GROUP BY 1
        ORDER BY c DESC, carne ASC
        LIMIT 50`
    );
    console.log(TAG, "reco/carnes =", rows);
    res.json({ ok: true, carnes: rows });
  } catch (e) {
    console.error(TAG, "reco/carnes error", e);
    res.status(500).json({ ok: false, msg: e.message });
  }
});

/** Filtrado por carné, sin joins — crudo de la tabla */
router.get("/reco/by-carne", async (req, res) => {
  try {
    const carne = String(req.query.carne ?? "").trim();
    if (!carne) return res.status(400).json({ ok: false, msg: "Falta ?carne=" });
    const { rows: totalCarne } = await db.query(
      `SELECT COUNT(*)::int AS c
         FROM "recomendacion_estandar" re
        WHERE BTRIM(re."carne_estudiante"::text) = BTRIM($1::text)`,
      [carne]
    );
    const { rows } = await db.query(
      `SELECT re.*
         FROM "recomendacion_estandar" re
        WHERE BTRIM(re."carne_estudiante"::text) = BTRIM($1::text)
        ORDER BY COALESCE(re."creado_en",'1970-01-01'::timestamp) DESC
        LIMIT 50`,
      [carne]
    );
    console.log(TAG, `reco/by-carne carne=${carne} -> total=${totalCarne?.[0]?.c} first=${rows.length}`);
    res.json({ ok: true, carne, total: totalCarne?.[0]?.c ?? 0, items: rows });
  } catch (e) {
    console.error(TAG, "reco/by-carne error", e);
    res.status(500).json({ ok: false, msg: e.message });
  }
});

/** Comparativa: filas con vigente true/false/null para ese carné */
router.get("/reco/by-carne/vigente", async (req, res) => {
  try {
    const carne = String(req.query.carne ?? "").trim();
    if (!carne) return res.status(400).json({ ok: false, msg: "Falta ?carne=" });

    const { rows: counts } = await db.query(
      `SELECT
           SUM(CASE WHEN re."vigente" IS TRUE  THEN 1 ELSE 0 END)::int AS vig_true,
           SUM(CASE WHEN re."vigente" IS FALSE THEN 1 ELSE 0 END)::int AS vig_false,
           SUM(CASE WHEN re."vigente" IS NULL  THEN 1 ELSE 0 END)::int AS vig_null
         FROM "recomendacion_estandar" re
        WHERE BTRIM(re."carne_estudiante"::text) = BTRIM($1::text)`,
      [carne]
    );

    const { rows: sample } = await db.query(
      `SELECT re.*
         FROM "recomendacion_estandar" re
        WHERE BTRIM(re."carne_estudiante"::text) = BTRIM($1::text)
        ORDER BY COALESCE(re."creado_en",'1970-01-01'::timestamp) DESC
        LIMIT 10`,
      [carne]
    );

    console.log(TAG, `reco/by-carne/vigente carne=${carne} ->`, counts?.[0], " sample=", sample);
    res.json({ ok: true, carne, counts: counts?.[0] ?? {}, sample });
  } catch (e) {
    console.error(TAG, "reco/by-carne/vigente error", e);
    res.status(500).json({ ok: false, msg: e.message });
  }
});

export default router;
