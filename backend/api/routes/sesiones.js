// backend/api/routes/sesiones.js
import express from "express";
import db from "../utils/db.js";

const router = express.Router();

/* Helpers */
function genPin(len = 6) {
  const ALF = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += ALF[Math.floor(Math.random() * ALF.length)];
  return s;
}
async function createUniquePin(len = 6) {
  for (let i = 0; i < 12; i++) {
    const cand = genPin(len);
    const q = await db.query(
      `SELECT 1 FROM "Sesion_evaluacion" WHERE "pin" = $1 LIMIT 1`,
      [cand]
    );
    if (q.rowCount === 0) return cand;
  }
  return `${genPin(4)}${Date.now().toString().slice(-2)}`;
}
async function getSesionById(id) {
  const q = await db.query(
    `SELECT "id_sesion","pin","nombre","id_clase",
            "creado_por_dpi","modo_adaptativo",
            "num_preg_max","tiempo_limite_seg",
            "estado","creado_en","abierta_en","cerrada_en",
            "iniciado_en","finalizado_en"
       FROM "Sesion_evaluacion"
      WHERE "id_sesion" = $1
      LIMIT 1`,
    [Number(id)]
  );
  return q.rows[0] || null;
}
async function getSesionByPin(pin) {
  const q = await db.query(
    `SELECT "id_sesion","pin","nombre","id_clase",
            "creado_por_dpi","modo_adaptativo",
            "num_preg_max","tiempo_limite_seg",
            "estado","creado_en","abierta_en","cerrada_en",
            "iniciado_en","finalizado_en"
       FROM "Sesion_evaluacion"
      WHERE "pin" = $1
      LIMIT 1`,
    [pin]
  );
  return q.rows[0] || null;
}

/* -------- POST crear sesión -------- */
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
      pin: pinInput,
    } = req.body;

    if (!nombre || !id_clase) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    // Resolver DPI
    let dpi = (creado_por_dpi || "").trim();
    if (!dpi && id_usuario) {
      const q = await db.query(
        `SELECT d."dpi" FROM "Docentes" d WHERE d."id_usuario" = $1 LIMIT 1`,
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

    // Config modalidad
    let numPreg = null;
    let tSeg = null;
    const mod =
      modalidad || (minutos ? "tiempo" : num_preg_max ? "num_preguntas" : "hasta_detener");
    if (mod === "num_preguntas") {
      if (!num_preg_max) return res.status(400).json({ ok: false, error: "num_preg_max_required" });
      numPreg = Number(num_preg_max);
    } else if (mod === "tiempo") {
      if (!minutos) return res.status(400).json({ ok: false, error: "minutos_required" });
      tSeg = Number(minutos) * 60;
    }

    // PIN único
    let pin = (pinInput || "").trim().toUpperCase();
    if (!pin) pin = await createUniquePin(6);

    // Insert
    const ins = await db.query(
      `INSERT INTO "Sesion_evaluacion"
        ("id_clase","creado_por_dpi","modo_adaptativo",
         "num_preg_max","tiempo_limite_seg",
         "estado","creado_en","nombre","pin")
       VALUES ($1,$2,$3,$4,$5,'programada', NOW(), $6, $7)
       RETURNING "id_sesion","estado","creado_en","pin"`,
      [Number(id_clase), dpi, !!modo_adaptativo, numPreg, tSeg, nombre, pin]
    );

    const row = ins.rows[0];
    res.json({
      ok: true,
      id_sesion: Number(row.id_sesion),
      estado: row.estado,
      creado_en: row.creado_en,
      pin: row.pin,
    });
  } catch (err) {
    console.error("POST /api/sesiones error:", err);
    next(err);
  }
});

/* -------- Resolver por PIN (PONER ANTES de /:id) -------- */
router.get("/by-pin/:pin", async (req, res, next) => {
  try {
    const { pin } = req.params;
    const ses = await getSesionByPin(pin);
    if (!ses) return res.status(404).json({ ok: false, error: "sesion_no_encontrada" });
    res.json({ ok: true, item: ses });
  } catch (err) { next(err); }
});
router.get("/by-code/:pin", async (req, res, next) => {
  try {
    const { pin } = req.params;
    const ses = await getSesionByPin(pin);
    if (!ses) return res.status(404).json({ ok: false, error: "sesion_no_encontrada" });
    res.json({ ok: true, item: ses });
  } catch (err) { next(err); }
});
router.get("/codigo/:pin", async (req, res, next) => {
  try {
    const { pin } = req.params;
    const ses = await getSesionByPin(pin);
    if (!ses) return res.status(404).json({ ok: false, error: "sesion_no_encontrada" });
    res.json({ ok: true, item: ses });
  } catch (err) { next(err); }
});

/* -------- Obtener por ID (DEJAR AL FINAL) -------- */
router.get("/:id_sesion", async (req, res, next) => {
  try {
    const n = Number(req.params.id_sesion);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ ok: false, error: "id_invalido" });
    }
    const ses = await getSesionById(n);
    if (!ses) return res.status(404).json({ ok: false, error: "sesion_no_encontrada" });
    res.json({ ok: true, item: ses });
  } catch (err) { next(err); }
});

export default router;
