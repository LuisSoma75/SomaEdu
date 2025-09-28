// api/controllers/adaptativeController.cjs
// Controlador en CommonJS para ser importado desde un router ESM.
// Requiere: api/utils/db.cjs  y  api/services/ia.cjs

const db = require("../utils/db.cjs");
const IA = require("../services/ia.cjs");

/**
 * Obtiene el estándar (id_estandar, Valor) más cercano al valor objetivo dentro de una materia.
 */
async function getClosestStandard(id_materia, targetValor) {
  const { rows } = await db.query(
    `
    SELECT e."id_estandar", e."Valor"
    FROM "Estandar" e
    JOIN "Tema" t ON e."id_tema" = t."id_tema"
    JOIN "Area" a ON t."id_area" = a."id_area"
    WHERE a."id_materia" = $1
    ORDER BY ABS(e."Valor" - $2) ASC
    LIMIT 1
    `,
    [id_materia, targetValor]
  );
  return rows[0] || null;
}

/**
 * Sube al siguiente estándar (mayor Valor) o baja al anterior (menor Valor).
 * dir = "up" | "down" | "stay"
 */
async function stepStandard(id_materia, currentValor, dir) {
  if (dir === "up") {
    const { rows } = await db.query(
      `
      SELECT e."id_estandar", e."Valor"
      FROM "Estandar" e
      JOIN "Tema" t ON e."id_tema" = t."id_tema"
      JOIN "Area" a ON t."id_area" = a."id_area"
      WHERE a."id_materia" = $1 AND e."Valor" > $2
      ORDER BY e."Valor" ASC
      LIMIT 1
      `,
      [id_materia, currentValor]
    );
    return rows[0] || { id_estandar: null, Valor: currentValor };
  }
  if (dir === "down") {
    const { rows } = await db.query(
      `
      SELECT e."id_estandar", e."Valor"
      FROM "Estandar" e
      JOIN "Tema" t ON e."id_tema" = t."id_tema"
      JOIN "Area" a ON t."id_area" = a."id_area"
      WHERE a."id_materia" = $1 AND e."Valor" < $2
      ORDER BY e."Valor" DESC
      LIMIT 1
      `,
      [id_materia, currentValor]
    );
    return rows[0] || { id_estandar: null, Valor: currentValor };
  }
  return { id_estandar: null, Valor: currentValor };
}

/**
 * Construye la lista de preguntas ya mostradas (para excluir en IA).
 */
async function getAskedQuestionIds(id_evaluacion) {
  const { rows } = await db.query(
    `
    SELECT DISTINCT "id_pregunta" FROM "Respuesta" WHERE "id_evaluacion" = $1
    UNION
    SELECT "id_pregunta" FROM "Detalle_evaluacion" WHERE "id_evaluacion" = $1
    `,
    [id_evaluacion]
  );
  return rows.map((r) => r.id_pregunta);
}

/**
 * Calcula rachas (últimas 2 respuestas).
 */
async function getRecentStreak(id_evaluacion) {
  const { rows } = await db.query(
    `
    SELECT "correcta"
    FROM "Respuesta"
    WHERE "id_evaluacion" = $1
    ORDER BY "id_respuesta" DESC
    LIMIT 2
    `,
    [id_evaluacion]
  );
  const streak = rows.map((r) => r.correcta === true);
  const twoRight = streak.length === 2 && streak.every(Boolean);
  const twoWrong = streak.length === 2 && streak.every((v) => v === false);
  return { twoRight, twoWrong };
}

/**
 * Devuelve el Valor del estándar de la pregunta dada.
 */
async function getValorFromPregunta(id_pregunta) {
  const { rows } = await db.query(
    `
    SELECT e."Valor"
    FROM "Pregunta" p
    JOIN "Estandar" e ON e."id_estandar" = p."id_estandar"
    WHERE p."id_pregunta" = $1
    `,
    [id_pregunta]
  );
  return rows.length ? Number(rows[0].Valor) : null;
}

/**
 * POST /api/adaptive/session/start
 * Body: { carne_estudiante, id_materia, num_preg_max }
 */
async function startSession(req, res) {
  const { carne_estudiante, id_materia, num_preg_max } = req.body;

  // 1) promedio del estudiante
  const s1 = await db.query(
    `SELECT "promedio" FROM "Estudiantes" WHERE "carne_estudiante" = $1`,
    [carne_estudiante]
  );
  if (!s1.rows.length) {
    return res.status(404).json({ ok: false, msg: "Estudiante no encontrado" });
  }
  const promedio = Number(s1.rows[0].promedio);

  // 2) estándar más cercano al promedio
  const std0 = await getClosestStandard(Number(id_materia), promedio);
  if (!std0) {
    return res.status(400).json({ ok: false, msg: "No hay estándares para la materia" });
  }

  // 3) pide a IA la 1ª pregunta
  const rankRes = await IA.rank({
    id_materia: Number(id_materia),
    target_valor: Number(std0.Valor),
    exclude: [],
    k: 1,
  });
  const firstQ = rankRes?.items?.[0];
  if (!firstQ) {
    return res.status(400).json({ ok: false, msg: "IA no devolvió preguntas" });
  }

  // 4) crea evaluación
  const ins = await db.query(
    `
    INSERT INTO "Evaluacion" 
      ("carne_estudiante","fecha_inicio","puntuacion_previa","id_materia","id_temporada")
    VALUES ($1, NOW(), $2, $3, NULL)
    RETURNING "id_evaluacion"
    `,
    [carne_estudiante, promedio, id_materia]
  );
  const id_evaluacion = ins.rows[0].id_evaluacion;

  // 5) registra "pregunta mostrada"
  await db.query(
    `INSERT INTO "Detalle_evaluacion" ("id_evaluacion","id_pregunta") VALUES ($1,$2)`,
    [id_evaluacion, firstQ.id_pregunta]
  );

  return res.json({
    ok: true,
    id_evaluacion,
    valor_estandar: Number(std0.Valor),
    pregunta: firstQ,
    num_preg_max: Number(num_preg_max),
  });
}

/**
 * POST /api/adaptive/session/:id/answer
 * Body: { id_pregunta, id_opcion, id_materia, valor_estandar_actual, tiempo_respuesta }
 */
async function submitAnswer(req, res) {
  const id_evaluacion = Number(req.params.id);
  const { id_pregunta, id_opcion, id_materia, valor_estandar_actual, tiempo_respuesta } = req.body;

  // 1) validar opción/corrección
  const opt = await db.query(
    `SELECT "correcta" FROM opciones_respuesta WHERE "id_opcion" = $1 AND "id_pregunta" = $2`,
    [id_opcion, id_pregunta]
  );
  if (!opt.rows.length) {
    return res.status(400).json({ ok: false, msg: "Opción inválida" });
  }
  const correcta = opt.rows[0].correcta === true;

  // 2) guarda respuesta
  await db.query(
    `
    INSERT INTO "Respuesta" 
      ("id_evaluacion","id_pregunta","id_opcion","correcta","tiempo_respuesta")
    VALUES ($1,$2,$3,$4,$5)
    `,
    [id_evaluacion, id_pregunta, id_opcion, correcta, Number(tiempo_respuesta || 0)]
  );

  // 3) racha de 2
  const { twoRight, twoWrong } = await getRecentStreak(id_evaluacion);

  // 4) valor estándar actual (si no lo mandan, lo deduzco de la pregunta)
  let currentValor =
    valor_estandar_actual !== undefined && valor_estandar_actual !== null
      ? Number(valor_estandar_actual)
      : (await getValorFromPregunta(id_pregunta)) ?? 0;

  // 5) determinar dirección
  const dir = twoRight ? "up" : twoWrong ? "down" : "stay";
  const stdNext =
    dir === "stay"
      ? { id_estandar: null, Valor: currentValor }
      : await stepStandard(Number(id_materia), currentValor, dir);

  const targetValor = Number(stdNext.Valor);

  // 6) exclude de preguntas ya vistas
  const exclude = await getAskedQuestionIds(id_evaluacion);

  // 7) pide a IA la siguiente
  const rankRes = await IA.rank({
    id_materia: Number(id_materia),
    target_valor: targetValor,
    exclude,
    k: 1,
  });

  const nextQ = rankRes?.items?.[0];

  if (!nextQ) {
    // fin de sesión (sin más preguntas)
    await db.query(
      `UPDATE "Evaluacion" SET "fecha_final" = NOW(), "puntuacion_final" = COALESCE("puntuacion_final",0) WHERE "id_evaluacion" = $1`,
      [id_evaluacion]
    );
    return res.json({ ok: true, correcta, fin: true, msg: "Sin más preguntas disponibles" });
  }

  // 8) registra "pregunta mostrada"
  await db.query(
    `INSERT INTO "Detalle_evaluacion" ("id_evaluacion","id_pregunta") VALUES ($1,$2)`,
    [id_evaluacion, nextQ.id_pregunta]
  );

  return res.json({
    ok: true,
    correcta,
    siguiente: {
      valor_estandar: targetValor,
      pregunta: nextQ,
    },
  });
}

/**
 * POST /api/adaptive/session/:id/end
 */
async function endSession(req, res) {
  const id_evaluacion = Number(req.params.id);
  await db.query(
    `UPDATE "Evaluacion" SET "fecha_final" = NOW() WHERE "id_evaluacion" = $1`,
    [id_evaluacion]
  );
  return res.json({ ok: true, msg: "Sesión finalizada" });
}

module.exports = {
  startSession,
  submitAnswer,
  endSession,
};
