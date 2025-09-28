// api/services/adaptiveService.js
const db = require("../utils/db"); // usa tu pool/cliente de Postgres
const axios = require("axios");

const IA_BASE_URL = process.env.IA_BASE_URL || "http://localhost:8000"; // FastAPI
const ADAPTIVE_MODE = true;

async function getStudentPromedio(carne_estudiante) {
  const q = `
    SELECT promedio 
    FROM ESTUDIANTES 
    WHERE carne_estudiante = $1
  `;
  const { rows } = await db.query(q, [carne_estudiante]);
  return rows[0]?.promedio ?? 0;
}

// estándar más cercano al promedio del estudiante (por materia)
async function getClosestEstandar(id_materia, objetivoValor) {
  const q = `
    SELECT e.id_estandar, e.valor
    FROM ESTANDAR e
    JOIN TEMA t ON e.id_tema = t.id_tema
    JOIN AREA a ON t.id_area = a.id_area
    WHERE a.id_materia = $1
    ORDER BY ABS(e.valor - $2) ASC
    LIMIT 1
  `;
  const { rows } = await db.query(q, [id_materia, objetivoValor]);
  return rows[0] || null;
}

async function getNeighborEstandar(id_materia, valorBase, direction /* +1 up, -1 down */) {
  const comparator = direction > 0 ? ">" : "<";
  const ordering = direction > 0 ? "ASC" : "DESC";
  const q = `
    SELECT e.id_estandar, e.valor
    FROM ESTANDAR e
    JOIN TEMA t ON e.id_tema = t.id_tema
    JOIN AREA a ON t.id_area = a.id_area
    WHERE a.id_materia = $1
      AND e.valor ${comparator} $2
    ORDER BY e.valor ${ordering}
    LIMIT 1
  `;
  const { rows } = await db.query(q, [id_materia, valorBase]);
  return rows[0] || null;
}

async function getQuestionForEstandar(id_estandar, id_evaluacion) {
  // pregunta activa no mostrada aún en esta evaluación
  const q = `
    SELECT p.id_pregunta, p.enunciado
    FROM PREGUNTA p
    WHERE p.activa = TRUE
      AND p.id_estandar = $1
      AND p.id_pregunta NOT IN (
        SELECT id_pregunta FROM DETALLE_EVALUACION WHERE id_evaluacion = $2
      )
    ORDER BY random()
    LIMIT 1
  `;
  const { rows } = await db.query(q, [id_estandar, id_evaluacion]);
  return rows[0] || null;
}

async function getOpciones(id_pregunta) {
  const q = `
    SELECT id_opcion, respuesta, correcta
    FROM OPCIONES_RESPUESTA
    WHERE id_pregunta = $1
    ORDER BY id_opcion ASC
  `;
  const { rows } = await db.query(q, [id_pregunta]);
  return rows;
}

async function createEvaluacion({ carne_estudiante, id_materia }) {
  const q = `
    INSERT INTO EVALUACION (carne_estudiante, fecha_inicio, puntuacion_previa, id_materia)
    VALUES ($1, NOW(), 0, $2) RETURNING id_evaluacion
  `;
  const { rows } = await db.query(q, [carne_estudiante, id_materia]);
  return rows[0].id_evaluacion;
}

async function createSesionEvaluacion({ id_clase = null, creado_por_dpi, num_preg_max, tiempo_limite_seg, id_evaluacion }) {
  const q = `
    INSERT INTO SESION_EVALUACION (i_clase, creado_por_dpi, modo_adapatativo, num_preg_max, tiempo_limite_seg, estado, creado_en, abierta_en)
    VALUES ($1, $2, $3, $4, $5, 'abierta', NOW(), NOW())
    RETURNING id_sesion
  `;
  const { rows } = await db.query(q, [id_clase, creado_por_dpi, ADAPTIVE_MODE, num_preg_max, tiempo_limite_seg]);
  // Guardar snapshot de promedio por área (opcional) o dejar para más adelante
  return rows[0].id_sesion;
}

async function attachDetalle(id_evaluacion, id_pregunta) {
  const q = `
    INSERT INTO DETALLE_EVALUACION (id_evaluacion, id_pregunta)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
  `;
  await db.query(q, [id_evaluacion, id_pregunta]);
}

async function getLastTwoCorrectFlags(id_evaluacion) {
  const q = `
    SELECT correcta
    FROM RESPUESTA
    WHERE id_evaluacion = $1
    ORDER BY id_respuesta DESC
    LIMIT 2
  `;
  const { rows } = await db.query(q, [id_evaluacion]);
  return rows.map(r => r.correcta === true);
}

async function countQuestionsAsked(id_evaluacion) {
  const q = `SELECT COUNT(*)::int AS c FROM DETALLE_EVALUACION WHERE id_evaluacion = $1`;
  const { rows } = await db.query(q, [id_evaluacion]);
  return rows[0].c;
}

async function getNumPregMaxByEval(id_evaluacion) {
  // como num_preg_max está en SESION_EVALUACION sin FK directa visible, usamos último registro creado (asumiendo 1:1 por sesión activa)
  const q = `
    SELECT num_preg_max
    FROM SESION_EVALUACION
    WHERE estado = 'abierta'
    ORDER BY id_sesion DESC
    LIMIT 1
  `;
  const { rows } = await db.query(q, []);
  return rows[0]?.num_preg_max ?? 10;
}

async function getCurrentEstandarValor(id_materia, id_evaluacion) {
  // Inferimos el estándar actual a partir de la última pregunta mostrada
  const q = `
    SELECT e.id_estandar, e.valor
    FROM DETALLE_EVALUACION de
    JOIN PREGUNTA p ON p.id_pregunta = de.id_pregunta
    JOIN ESTANDAR e ON e.id_estandar = p.id_estandar
    WHERE de.id_evaluacion = $1
    ORDER BY de.id_det_evaluacion DESC
    LIMIT 1
  `;
  const { rows } = await db.query(q, [id_evaluacion]);
  if (rows.length) return rows[0];
  return null;
}

async function getPreguntaConBertRanking(id_estandar, id_materia, id_evaluacion) {
  // pídale al microservicio IA que rankee por dificultad ~ valor estándar
  try {
    const { data } = await axios.get(`${IA_BASE_URL}/rank`, {
      params: { id_estandar, id_materia, id_evaluacion }
    });
    if (data?.id_pregunta) {
      // si IA sugiere pregunta específica, úsala
      const q = `
        SELECT id_pregunta, enunciado
        FROM PREGUNTA
        WHERE id_pregunta = $1 AND activa = TRUE
      `;
      const { rows } = await db.query(q, [data.id_pregunta]);
      return rows[0] || null;
    }
  } catch (e) {
    console.warn("IA rank fallback:", e.message);
  }
  // fallback aleatorio si IA no está disponible
  return getQuestionForEstandar(id_estandar, id_evaluacion);
}

module.exports = {
  async startSession({ carne_estudiante, id_materia, num_preg_max, tiempo_limite_seg, creado_por_dpi }) {
    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      const promedio = await getStudentPromedio(carne_estudiante);
      const estandar0 = await getClosestEstandar(id_materia, promedio);
      if (!estandar0) throw new Error("No hay estándares para la materia");

      const id_evaluacion = await createEvaluacion({ carne_estudiante, id_materia });
      await createSesionEvaluacion({ creado_por_dpi, num_preg_max, tiempo_limite_seg, id_evaluacion });

      const pregunta = await getPreguntaConBertRanking(estandar0.id_estandar, id_materia, id_evaluacion);
      if (!pregunta) throw new Error("No hay preguntas activas para el estándar inicial");

      await attachDetalle(id_evaluacion, pregunta.id_pregunta);
      const opciones = await getOpciones(pregunta.id_pregunta);

      await client.query("COMMIT");
      return { id_evaluacion, estandar_inicial: estandar0, pregunta_inicial: { ...pregunta, opciones } };
    } catch (e) {
      await db.safeRollback(client);
      throw e;
    } finally {
      client.release();
    }
  },

  async submitAnswer({ id_evaluacion, id_pregunta, id_opcion, tiempo_respuesta }) {
    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // ¿la opción era correcta?
      const { rows: opt } = await client.query(
        `SELECT correcta FROM OPCIONES_RESPUESTA WHERE id_opcion = $1 AND id_pregunta = $2`,
        [id_opcion, id_pregunta]
      );
      if (!opt.length) throw new Error("Opción inválida");
      const correcta = opt[0].correcta === true;

      // Guardar RESPUESTA
      await client.query(
        `INSERT INTO RESPUESTA (id_evaluacion, id_pregunta, id_opcion, correcta, tiempo_respuesta)
         VALUES ($1, $2, $3, $4, $5)`,
        [id_evaluacion, id_pregunta, id_opcion, correcta, tiempo_respuesta]
      );

      // Actualizar RESUMEN_EVAL_ESTANDAR (conteos); si no existe, crear
      await client.query(`
        INSERT INTO RESUMEN_EVAL_ESTANDAR (id_evaluacion, id_estandar, preguntas_mostradas, correctas, incorrectas, dificultad_prom)
        SELECT $1, p.id_estandar, 1, CASE WHEN $2 THEN 1 ELSE 0 END, CASE WHEN $2 THEN 0 ELSE 1 END, 0
        FROM PREGUNTA p WHERE p.id_pregunta = $3
        ON CONFLICT (id_evaluacion, id_estandar) DO UPDATE
        SET preguntas_mostradas = RESUMEN_EVAL_ESTANDAR.preguntas_mostradas + 1,
            correctas = RESUMEN_EVAL_ESTANDAR.correctas + CASE WHEN EXCLUDED.correctas=1 THEN 1 ELSE 0 END,
            incorrectas = RESUMEN_EVAL_ESTANDAR.incorrectas + CASE WHEN EXCLUDED.incorrectas=1 THEN 1 ELSE 0 END;
      `, [id_evaluacion, correcta, id_pregunta]);

      const numMostradas = await countQuestionsAsked(id_evaluacion);
      const numMax = await getNumPregMaxByEval(id_evaluacion);

      if (numMostradas >= numMax) {
        // cerrar evaluación
        await client.query(
          `UPDATE EVALUACION SET fecha_final = NOW(), puntuacion_final = (
             SELECT COALESCE(AVG(CASE WHEN correcta THEN 1 ELSE 0 END),0) * 100
             FROM RESPUESTA WHERE id_evaluacion = $1
           ) WHERE id_evaluacion = $1`,
          [id_evaluacion]
        );
        await client.query(
          `UPDATE SESION_EVALUACION SET estado='cerrada', cerrada_en=NOW() WHERE estado='abierta'`
        );
        await client.query("COMMIT");
        return { finished: true };
      }

      // lógica de 2 seguidas
      const flags = await getLastTwoCorrectFlags(id_evaluacion);
      let direction = 0; // 0 = igual estándar, +1 sube, -1 baja
      if (flags.length === 2) {
        if (flags[0] && flags[1]) direction = +1;
        if (!flags[0] && !flags[1]) direction = -1;
      }

      // estandar actual (el de la última pregunta mostrada)
      const current = await getCurrentEstandarValor(null, id_evaluacion);
      if (!current) throw new Error("No se pudo inferir el estándar actual");

      let nextEstd = current;
      if (direction !== 0) {
        const candidate = await getNeighborEstandar(null, current.valor, direction);
        nextEstd = candidate || current; // límites
      }

      // siguiente pregunta (intenta ranking por IA; fallback aleatorio)
      const nextQ = await getPreguntaConBertRanking(nextEstd.id_estandar, null, id_evaluacion);
      if (!nextQ) {
        await client.query("COMMIT");
        return { finished: true }; // no hay más preguntas en ese estándar
      }

      await attachDetalle(id_evaluacion, nextQ.id_pregunta);
      const opciones = await getOpciones(nextQ.id_pregunta);

      await client.query("COMMIT");
      return {
        finished: false,
        next: { estandar: nextEstd, pregunta: { ...nextQ, opciones } }
      };
    } catch (e) {
      await db.safeRollback(client);
      throw e;
    } finally {
      client.release();
    }
  },

  async endSession({ id_evaluacion }) {
    await db.query(
      `UPDATE EVALUACION SET fecha_final = COALESCE(fecha_final, NOW()), 
        puntuacion_final = COALESCE(puntuacion_final, (
          SELECT COALESCE(AVG(CASE WHEN correcta THEN 1 ELSE 0 END),0) * 100 FROM RESPUESTA WHERE id_evaluacion = $1
        ))
       WHERE id_evaluacion = $1`,
      [id_evaluacion]
    );
    await db.query(`UPDATE SESION_EVALUACION SET estado='cerrada', cerrada_en=NOW() WHERE estado='abierta'`);
    return { finished: true };
  },
};
