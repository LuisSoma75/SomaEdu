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
 *  - carne_estudiante: string | number   (obligatorio)
 *  - id_materia: number                  (obligatorio)
 *  - num_preg_max: number                (opcional)
 *  - id_sesion: number                   (opcional)
 */
router.post(
  "/session/start",
  // requireAuth, // <- si tienes middleware de auth, actívalo aquí
  must("carne_estudiante", "id_materia"),
  asyncH(async (req, res) => {
    console.log("[ADAPTIVE] POST /session/start body =", req.body);

    // Normaliza tipos numéricos si fuera necesario
    req.body.id_materia = asNum(req.body.id_materia);
    if (req.body.num_preg_max !== undefined) {
      req.body.num_preg_max = asNum(req.body.num_preg_max);
    }
    if (req.body.id_sesion !== undefined) {
      req.body.id_sesion = asNum(req.body.id_sesion);
    }

    return AdaptiveController.startSession(req, res);
  })
);

/**
 * Envía respuesta y devuelve la siguiente (o fin)
 * Params:
 *  - :id = id_evaluacion (numérico)
 * Body:
 *  - id_pregunta: number                 (obligatorio)
 *  - id_opcion: number                   (obligatorio)
 *  - id_materia: number                  (obligatorio)
 *  - valor_estandar_actual: number       (opcional)
 *  - tiempo_respuesta: number (segundos) (opcional)
 *  - num_preg_max: number                (opcional)
 */
router.post(
  "/session/:id/answer",
  // requireAuth,
  must("id_pregunta", "id_opcion", "id_materia"),
  asyncH(async (req, res) => {
    console.log("[ADAPTIVE] POST /session/:id/answer params =", req.params);
    console.log("[ADAPTIVE] POST /session/:id/answer body   =", req.body);

    // Normaliza ID de evaluación y demás numéricos
    req.params.id = asNum(req.params.id);
    req.body.id_pregunta = asNum(req.body.id_pregunta);
    req.body.id_opcion = asNum(req.body.id_opcion);
    req.body.id_materia = asNum(req.body.id_materia);
    if (req.body.valor_estandar_actual !== undefined) {
      req.body.valor_estandar_actual = asNum(req.body.valor_estandar_actual);
    }
    if (req.body.tiempo_respuesta !== undefined) {
      req.body.tiempo_respuesta = asNum(req.body.tiempo_respuesta);
    }
    if (req.body.num_preg_max !== undefined) {
      req.body.num_preg_max = asNum(req.body.num_preg_max);
    }

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

/**
 * Obtiene notas por área para una evaluación
 * Params:
 *  - :id = id_evaluacion (numérico)
 */
router.get(
  "/session/:id/areas",
  // requireAuth,
  asyncH(async (req, res) => {
    console.log("[ADAPTIVE] GET /session/:id/areas params =", req.params);
    req.params.id = asNum(req.params.id);
    return AdaptiveController.areasByEvaluacion(req, res);
  })
);

export default router;
