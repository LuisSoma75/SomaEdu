// api/routes/adaptative.js
import { Router } from "express";
import AdaptiveController from "../controllers/adaptativeController.cjs";

const router = Router();

// ===== Helpers =====

// Wrap async handlers para evitar try/catch repetidos
const asyncH = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Validador de campos obligatorios en body
const must = (...fields) => (req, res, next) => {
  const missing = fields.filter(
    (f) => req.body[f] === undefined || req.body[f] === null
  );
  if (missing.length) {
    return res
      .status(400)
      .json({ ok: false, msg: `Faltan campos: ${missing.join(", ")}` });
  }
  next();
};

// Parseo seguro a número (si aplica)
const asNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ===== Rutas =====

// Healthcheck opcional
router.get("/", (req, res) => res.json({ ok: true, msg: "adaptive ok" }));

/**
 * Inicia sesión adaptativa y devuelve la 1ª pregunta
 * Body:
 *  - carne_estudiante: string | number
 *  - id_materia: number
 *  - num_preg_max: number
 *
 * Nota: este endpoint inicia la lógica adaptativa y debe retornar
 * la primera pregunta según tu controlador (AdaptiveController.startSession).
 */
router.post(
  "/session/start",
  // requireAuth, // <- si tienes middleware de auth, actívalo aquí
  must("carne_estudiante", "id_materia", "num_preg_max"),
  asyncH(async (req, res) => {
    // Logs útiles
    console.log("[ADAPTIVE] POST /session/start body =", req.body);

    // Normaliza tipos numéricos si fuera necesario
    req.body.id_materia = asNum(req.body.id_materia);
    req.body.num_preg_max = asNum(req.body.num_preg_max);

    return AdaptiveController.startSession(req, res);
  })
);

/**
 * Envía respuesta y devuelve la siguiente (o fin)
 * Params:
 *  - :id = id_evaluacion (numérico)
 * Body:
 *  - id_pregunta: number
 *  - id_opcion: number
 *  - id_materia: number
 *  - valor_estandar_actual: number (ej. habilidad/θ estimada actual)
 *
 * El controlador deberá responder con la siguiente pregunta o indicar fin.
 */
router.post(
  "/session/:id/answer",
  // requireAuth,
  must("id_pregunta", "id_opcion", "id_materia", "valor_estandar_actual"),
  asyncH(async (req, res) => {
    console.log("[ADAPTIVE] POST /session/:id/answer params =", req.params);
    console.log("[ADAPTIVE] POST /session/:id/answer body   =", req.body);

    // Normaliza ID de evaluación y demás numéricos
    req.params.id = asNum(req.params.id);
    req.body.id_pregunta = asNum(req.body.id_pregunta);
    req.body.id_opcion = asNum(req.body.id_opcion);
    req.body.id_materia = asNum(req.body.id_materia);
    req.body.valor_estandar_actual = Number(req.body.valor_estandar_actual);

    return AdaptiveController.submitAnswer(req, res);
  })
);

/**
 * Finaliza la sesión manualmente (opcional)
 * Params:
 *  - :id = id_evaluacion (numérico)
 */
router.post(
  "/session/:id/end",
  // requireAuth,
  asyncH(async (req, res) => {
    console.log("[ADAPTIVE] POST /session/:id/end params =", req.params);
    req.params.id = asNum(req.params.id);
    return AdaptiveController.endSession(req, res);
  })
);

export default router;
