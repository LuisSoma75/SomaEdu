// api/routes/adaptative.js
import { Router } from "express";
import AdaptiveController from "../controllers/adaptativeController.cjs";

const router = Router();

// Helper para async sin try/catch repetido
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Validador de campos obligatorios en body
const must = (...fields) => (req, res, next) => {
  const missing = fields.filter((f) => req.body[f] === undefined || req.body[f] === null);
  if (missing.length) return res.status(400).json({ ok: false, msg: `Faltan campos: ${missing.join(", ")}` });
  next();
};

// -------------------- RUTAS --------------------

// Inicia sesión adaptativa y devuelve la 1ª pregunta
// Body: { carne_estudiante, id_materia, num_preg_max }
router.post(
  "/session/start",
  // requireAuth,
  must("carne_estudiante", "id_materia", "num_preg_max"),
  asyncH(AdaptiveController.startSession)
);

// Envía respuesta y devuelve la siguiente (o fin)
// Params: :id = id_evaluacion
// Body: { id_pregunta, id_opcion, id_materia, valor_estandar_actual }
router.post(
  "/session/:id/answer",
  // requireAuth,
  must("id_pregunta", "id_opcion", "id_materia", "valor_estandar_actual"),
  asyncH(AdaptiveController.submitAnswer)
);

// Finaliza la sesión manualmente (opcional)
// Params: :id = id_evaluacion
router.post(
  "/session/:id/end",
  // requireAuth,
  asyncH(AdaptiveController.endSession)
);

// (opcional) raíz para test rápido
router.get("/", (req, res) => res.json({ ok: true, msg: "adaptive ok" }));

export default router;
