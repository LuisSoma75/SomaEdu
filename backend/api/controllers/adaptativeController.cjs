// api/controllers/adaptativeController.cjs
// Controlador CommonJS.
// IA rankea preguntas; BD provee enunciados/opciones y persiste progreso.

const db = require("../utils/db.cjs");
const IA = require("../services/ia.cjs");

const DBG = true;
const log  = (...a) => DBG && console.log("[ADAPTIVE]", ...a);
const warn = (...a) => DBG && console.warn("[ADAPTIVE]", ...a);

/* ==================================
   Utilidades BD genéricas / schema
================================== */

async function tableColumns(table) {
  const { rows } = await db.query(
    `SELECT column_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [String(table)]
  );
  return rows.map(r => ({
    name: r.column_name,
    required: (r.is_nullable === "NO") && (r.column_default == null),
    hasDefault: r.column_default != null,
  }));
}

async function hasColumns(table, names) {
  const cols = await tableColumns(table);
  const set = new Set(cols.map(c => c.name.toLowerCase()));
  return names.every(n => set.has(String(n).toLowerCase()));
}

async function existsSesion(id_sesion) {
  if (!Number.isFinite(Number(id_sesion))) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM "Sesion_evaluacion" WHERE "id_sesion"=$1`,
    [Number(id_sesion)]
  );
  return !!rows.length;
}

/* ==================================
   Helpers de dominio
================================== */

// estándar más cercano al target
async function getClosestStandard(id_materia, targetValorNum) {
  const { rows } = await db.query(
    `
    SELECT e."id_estandar", e."Valor"::numeric AS "Valor"
    FROM "Estandar" e
    JOIN "Tema"  t ON e."id_tema" = t."id_tema"
    JOIN "Area"  a ON t."id_area" = a."id_area"
    WHERE a."id_materia" = $1
    ORDER BY ABS(e."Valor"::numeric - $2::numeric) ASC
    LIMIT 1
    `,
    [Number(id_materia), Number(targetValorNum || 0)]
  );
  return rows[0] || null;
}

// siguiente/prev estándar
async function stepStandard(id_materia, currentValor, dir) {
  if (dir === "up") {
    const { rows } = await db.query(
      `
      SELECT e."id_estandar", e."Valor"::numeric AS "Valor"
      FROM "Estandar" e
      JOIN "Tema"  t ON e."id_tema" = t."id_tema"
      JOIN "Area"  a ON t."id_area" = a."id_area"
      WHERE a."id_materia" = $1 AND e."Valor"::numeric > $2::numeric
      ORDER BY e."Valor"::numeric ASC
      LIMIT 1
      `,
      [id_materia, currentValor]
    );
    return rows[0] || { id_estandar: null, Valor: currentValor };
  }
  if (dir === "down") {
    const { rows } = await db.query(
      `
      SELECT e."id_estandar", e."Valor"::numeric AS "Valor"
      FROM "Estandar" e
      JOIN "Tema"  t ON e."id_tema" = t."id_tema"
      JOIN "Area"  a ON t."id_area" = a."id_area"
      WHERE a."id_materia" = $1 AND e."Valor"::numeric < $2::numeric
      ORDER BY e."Valor"::numeric DESC
      LIMIT 1
      `,
      [id_materia, currentValor]
    );
    return rows[0] || { id_estandar: null, Valor: currentValor };
  }
  return { id_estandar: null, Valor: currentValor };
}

// preguntas ya mostradas en la evaluación
async function getAskedQuestionIds(id_evaluacion) {
  const { rows } = await db.query(
    `SELECT "id_pregunta" FROM "Detalle_evaluacion" WHERE "id_evaluacion"=$1 ORDER BY 1`,
    [id_evaluacion]
  );
  return rows.map(r => Number(r.id_pregunta));
}

// Valor estándar de una pregunta
async function getValorFromPregunta(id_pregunta) {
  const { rows } = await db.query(
    `
    SELECT e."Valor"::numeric AS "Valor"
    FROM "Pregunta" p
    JOIN "Estandar" e ON e."id_estandar"=p."id_estandar"
    WHERE p."id_pregunta"=$1
    `,
    [id_pregunta]
  );
  return rows.length ? Number(rows[0].Valor) : null;
}

// Enunciado desde BD
async function getEnunciado(id_pregunta) {
  const { rows } = await db.query(
    `SELECT "enunciado" FROM "Pregunta" WHERE "id_pregunta"=$1`,
    [id_pregunta]
  );
  return rows.length ? String(rows[0].enunciado) : "Enunciado no disponible";
}

// Opciones desde BD, tolerando nombres de columnas alternos
async function loadOptionsFromDB(id_pregunta) {
  const pid = Number(id_pregunta);

  if (await hasColumns("opciones_respuesta", ["id_opcion","id_pregunta","opcion"])) {
    const { rows } = await db.query(
      `SELECT "id_opcion","opcion" AS texto,"correcta"
       FROM "opciones_respuesta"
       WHERE "id_pregunta"=$1 ORDER BY "id_opcion"`,
      [pid]
    );
    if (rows.length) {
      return rows.map(r => ({
        id_opcion: Number(r.id_opcion),
        texto: String(r.texto),
        ...(r.correcta != null ? { correcta: !!r.correcta } : {})
      }));
    }
  }

  if (await hasColumns("Respuesta", ["id_respuesta","id_pregunta","respuesta"])) {
    const { rows } = await db.query(
      `SELECT "id_respuesta" AS id,"respuesta" AS texto,"correcta" AS ok
       FROM "Respuesta" WHERE "id_pregunta"=$1 ORDER BY "id_respuesta"`,
      [pid]
    );
    if (rows.length) {
      return rows.map(r => ({
        id_opcion: Number(r.id),
        texto: String(r.texto),
        ...(r.ok != null ? { correcta: !!r.ok } : {})
      }));
    }
  }

  // introspección genérica (último recurso)
  const tabs = await db.query(
    `SELECT table_name
     FROM information_schema.columns
     WHERE table_schema='public' AND column_name ILIKE 'id_pregunta'
     GROUP BY table_name`
  );
  for (const t of tabs.rows.map(r => r.table_name)) {
    const cols = await tableColumns(t);
    const set  = new Set(cols.map(c => c.name.toLowerCase()));
    if (!set.has("id_pregunta")) continue;

    const cId =
      set.has("id_opcion")    ? "id_opcion"    :
      set.has("id_respuesta") ? "id_respuesta" :
      set.has("id")           ? "id"           : null;
    const cTxt =
      set.has("opcion")       ? "opcion"       :
      set.has("respuesta")    ? "respuesta"    :
      set.has("texto")        ? "texto"        :
      set.has("descripcion")  ? "descripcion"  : null;
    const cOk = set.has("correcta") ? "correcta" : null;
    if (!cId || !cTxt) continue;

    const sql = `
      SELECT "${cId}" AS id, "${cTxt}" AS texto${cOk ? `, "${cOk}" AS ok` : ""}
      FROM "${t}" WHERE "id_pregunta"=$1 ORDER BY 1
    `;
    const { rows } = await db.query(sql, [pid]);
    if (rows.length) {
      return rows.map(r => ({
        id_opcion: Number(r.id),
        texto: String(r.texto),
        ...(r.ok != null ? { correcta: !!r.ok } : {})
      }));
    }
  }

  return [];
}

// ¿La opción marcada es correcta?
async function isOptionCorrect(id_opcion, id_pregunta) {
  const trySql = async (sql, params) => {
    try {
      const { rows } = await db.query(sql, params);
      if (rows.length && rows[0].ok !== undefined) return !!rows[0].ok;
    } catch {}
    return null;
  };

  let v = await trySql(
    `SELECT "correcta" AS ok FROM "opciones_respuesta" WHERE "id_opcion"=$1 AND "id_pregunta"=$2`,
    [id_opcion, id_pregunta]
  );
  if (v !== null) return v;

  v = await trySql(
    `SELECT "correcta" AS ok FROM "Respuesta" WHERE "id_respuesta"=$1 AND "id_pregunta"=$2`,
    [id_opcion, id_pregunta]
  );
  if (v !== null) return v;

  return false;
}

// temporada activa (o la más reciente)
async function getTemporadaActivaId() {
  const { rows } = await db.query(
    `SELECT "id_temporada"
     FROM "Temporada"
     ORDER BY COALESCE("fecha_inicio",'1970-01-01') DESC
     LIMIT 1`
  );
  return rows.length ? Number(rows[0].id_temporada) : null;
}

// Busca una clase compatible (grado + materia)
async function findClaseIdFor(id_grado, id_materia) {
  if (await hasColumns("Clase", ["id_clase"])) {
    const hasG = await hasColumns("Clase", ["id_grado"]);
    const hasM = await hasColumns("Clase", ["id_materia"]);
    if (hasG && hasM) {
      const { rows } = await db.query(
        `SELECT "id_clase"
         FROM "Clase"
         WHERE "id_grado"=$1 AND "id_materia"=$2
         ORDER BY "id_clase" ASC
         LIMIT 1`,
        [id_grado, id_materia]
      );
      if (rows.length) return Number(rows[0].id_clase);
    }
    if (hasG) {
      const { rows } = await db.query(
        `SELECT "id_clase" FROM "Clase" WHERE "id_grado"=$1 ORDER BY "id_clase" ASC LIMIT 1`,
        [id_grado]
      );
      if (rows.length) return Number(rows[0].id_clase);
    }
    if (hasM) {
      const { rows } = await db.query(
        `SELECT "id_clase" FROM "Clase" WHERE "id_materia"=$1 ORDER BY "id_clase" ASC LIMIT 1`,
        [id_materia]
      );
      if (rows.length) return Number(rows[0].id_clase);
    }
  }
  // Fallback vía sesiones (si existieran)
  if (await hasColumns("Sesion_evaluacion", ["id_clase"])) {
    const { rows } = await db.query(
      `
      SELECT c."id_clase"
      FROM "Sesion_evaluacion" se
      JOIN "Clase" c ON c."id_clase" = se."id_clase"
      WHERE ($1::int IS NULL OR c."id_grado"=$1)
        AND ($2::int IS NULL OR c."id_materia"=$2)
      ORDER BY COALESCE(se."iniciado_en", se."creado_en") DESC NULLS LAST, se."id_sesion" DESC
      LIMIT 1
      `,
      [id_grado || null, id_materia || null]
    );
    if (rows.length) return Number(rows[0].id_clase);
  }
  return null;
}

/**
 * Asegura (o crea) una matrícula. Incluye id_clase y fecha_alta si son obligatorias.
 */
async function ensureMatricula(carne_estudiante, id_materia) {
  const carne = String(carne_estudiante);

  const mCols = await tableColumns("Matricula");
  const mSet  = new Set(mCols.map(c => c.name.toLowerCase()));

  const eCols = await tableColumns("Estudiantes");
  const eSet  = new Set(eCols.map(c => c.name.toLowerCase()));

  const temporadaId = await getTemporadaActivaId();

  // 1) intentos por carne_*
  const tryByCarne = async () => {
    if (mSet.has("carne_estudiante")) {
      if (temporadaId != null && mSet.has("id_temporada")) {
        const r = await db.query(
          `SELECT "id_matricula" FROM "Matricula"
           WHERE "carne_estudiante"=$1 AND "id_temporada"=$2
           ORDER BY "id_matricula" DESC LIMIT 1`,
          [carne, temporadaId]
        );
        if (r.rows.length) return Number(r.rows[0].id_matricula);
      }
      const r2 = await db.query(
        `SELECT "id_matricula" FROM "Matricula"
         WHERE "carne_estudiante"=$1
         ORDER BY "id_matricula" DESC LIMIT 1`,
        [carne]
      );
      if (r2.rows.length) return Number(r2.rows[0].id_matricula);
    }
    if (mSet.has("carne_est")) {
      const r3 = await db.query(
        `SELECT "id_matricula" FROM "Matricula"
         WHERE "carne_est"=$1 ORDER BY "id_matricula" DESC LIMIT 1`,
        [carne]
      );
      if (r3.rows.length) return Number(r3.rows[0].id_matricula);
    }
    return null;
  };
  const foundByCarne = await tryByCarne();
  if (foundByCarne != null) return foundByCarne;

  // 2) intento por id_estudiante SOLO si ambas tablas lo soportan
  if (mSet.has("id_estudiante") && eSet.has("id_estudiante")) {
    const sRes = await db.query(
      `SELECT "id_estudiante"
       FROM "Estudiantes"
       WHERE "carne_estudiante"=$1
       LIMIT 1`,
      [carne]
    );
    const sid = sRes.rows.length ? Number(sRes.rows[0].id_estudiante) : null;
    if (sid != null) {
      if (temporadaId != null && mSet.has("id_temporada")) {
        const r = await db.query(
          `SELECT "id_matricula" FROM "Matricula"
           WHERE "id_estudiante"=$1 AND "id_temporada"=$2
           ORDER BY "id_matricula" DESC LIMIT 1`,
          [sid, temporadaId]
        );
        if (r.rows.length) return Number(r.rows[0].id_matricula);
      }
      const r2 = await db.query(
        `SELECT "id_matricula" FROM "Matricula"
         WHERE "id_estudiante"=$1 ORDER BY "id_matricula" DESC LIMIT 1`,
        [sid]
      );
      if (r2.rows.length) return Number(r2.rows[0].id_matricula);
    }
  }

  // 3) crear matrícula (llenando NOT NULL requeridos)
  // Datos base del estudiante
  let id_estudiante_val = null;
  let id_grado_val = null;

  if (eSet.has("id_estudiante")) {
    const eRes = await db.query(
      `SELECT "id_estudiante","id_grado"
       FROM "Estudiantes" WHERE "carne_estudiante"=$1 LIMIT 1`,
      [carne]
    );
    if (!eRes.rows.length) {
      throw Object.assign(new Error("No se encontró el estudiante."), { status: 400 });
    }
    id_estudiante_val = Number(eRes.rows[0].id_estudiante);
    id_grado_val = eRes.rows[0].id_grado != null ? Number(eRes.rows[0].id_grado) : null;
  } else {
    if (eSet.has("id_grado")) {
      const gRes = await db.query(
        `SELECT "id_grado" FROM "Estudiantes" WHERE "carne_estudiante"=$1 LIMIT 1`,
        [carne]
      );
      if (gRes.rows.length) id_grado_val = gRes.rows[0].id_grado != null ? Number(gRes.rows[0].id_grado) : null;
    }
  }

  // ¿Matricula requiere id_clase o fecha_alta?
  const required = mCols.filter(c => c.required).map(c => c.name.toLowerCase());
  let id_clase_val = null;

  if (mSet.has("id_clase") && required.includes("id_clase")) {
    id_clase_val = await findClaseIdFor(id_grado_val, Number(id_materia));
    if (id_clase_val == null) {
      throw Object.assign(
        new Error("No se encontró una clase para el grado del estudiante y la materia."),
        { status: 400 }
      );
    }
  }

  const now = new Date();

  // construir payload según columnas existentes
  const values = {};
  const canUse = (n) => mSet.has(n.toLowerCase());

  if (canUse("id_estudiante") && id_estudiante_val != null) values.id_estudiante = id_estudiante_val;
  if (canUse("id_temporada") && temporadaId != null) values.id_temporada = temporadaId;
  if (canUse("id_grado") && id_grado_val != null) values.id_grado = id_grado_val;
  if (canUse("carne_estudiante")) values.carne_estudiante = carne;
  if (canUse("carne_est")) values.carne_est = carne;

  if (canUse("id_clase") && id_clase_val != null) values.id_clase = id_clase_val;

  // fecha de alta / matrícula (según exista)
  if (canUse("fecha_alta")) values.fecha_alta = now;
  else if (canUse("fecha_matricula")) values.fecha_matricula = now;

  // verificar NOT NULL sin default
  const missing = required.filter(r => values[r] === undefined);
  if (missing.length) {
    throw Object.assign(
      new Error(`No se pudo crear la matrícula: faltan columnas obligatorias (${missing.join(", ")}).`),
      { status: 400 }
    );
  }

  const cols = Object.keys(values);
  const params = cols.map((_, i) => `$${i+1}`);
  const sql = `
    INSERT INTO "Matricula" (${cols.map(c => `"${c}"`).join(",")})
    VALUES (${params.join(",")})
    RETURNING "id_matricula"
  `;
  const { rows: ins } = await db.query(sql, cols.map(c => values[c]));
  const newId = Number(ins[0].id_matricula);
  log("Matricula creada:", { id_matricula: newId, cols });
  return newId;
}

/**
 * Crea Evaluacion respetando columnas reales.
 * - Solo inserta id_sesion si es válido y EXISTE en "Sesion_evaluacion".
 */
async function createEvaluacionFlex({ carne_est, id_materia, id_sesion }) {
  const cols = await tableColumns("Evaluacion");
  const set  = new Set(cols.map(c => c.name.toLowerCase()));
  const requiredCols = cols.filter(c => c.required).map(c => c.name.toLowerCase());

  const values = {};
  const addIf = (name, val) => { if (set.has(name)) values[name] = val; };

  addIf("id_materia", Number(id_materia));
  addIf("fecha_inicio", new Date());

  if (set.has("carne_est")) addIf("carne_est", String(carne_est));
  if (set.has("carne_estudiante")) addIf("carne_estudiante", String(carne_est));

  if (set.has("id_temporada")) {
    const tmpId = await getTemporadaActivaId();
    if (tmpId == null && requiredCols.includes("id_temporada")) {
      throw Object.assign(new Error("No hay temporada activa."), { status: 400 });
    }
    if (tmpId != null) values.id_temporada = tmpId;
  }

  if (set.has("id_matricula")) {
    values.id_matricula = await ensureMatricula(String(carne_est), Number(id_materia));
  }

  // id_sesion: incluir SOLO si existe la columna, viene un número y la FK existe
  if (set.has("id_sesion") && Number.isFinite(Number(id_sesion)) && (await existsSesion(id_sesion))) {
    values.id_sesion = Number(id_sesion);
  }

  const missing = cols
    .filter(c => c.required)
    .map(c => c.name)
    .filter(n => values[n] === undefined);

  if (missing.length) {
    throw Object.assign(
      new Error(`No se pudo crear la evaluación: faltan columnas obligatorias (${missing.join(", ")}).`),
      { status: 400 }
    );
  }

  const cNames = Object.keys(values);
  const params = cNames.map((_, i) => `$${i+1}`);
  const sql = `
    INSERT INTO "Evaluacion" (${cNames.map(c => `"${c}"`).join(",")})
    VALUES (${params.join(",")})
    RETURNING "id_evaluacion"
  `;
  const { rows } = await db.query(sql, cNames.map(c => values[c]));
  return Number(rows[0].id_evaluacion);
}

/* ==================================
   Endpoints
================================== */

async function startSession(req, res) {
  try {
    const { carne_estudiante, id_materia, num_preg_max } = req.body;
    log("POST /session/start body =", req.body);

    // Resolver id_sesion desde body/query/params (y validar que exista)
    let id_sesion =
      req.body?.id_sesion ??
      req.body?.sessionId ??
      req.query?.id_sesion ??
      req.query?.sessionId ??
      req.params?.id_sesion ??
      req.params?.id;

    if (!(await existsSesion(id_sesion))) {
      id_sesion = null; // evita FK inválida (p.ej., 0)
    }

    // promedio
    let promedio = 0;
    try {
      const s1 = await db.query(
        `SELECT "promedio" FROM "Estudiantes" WHERE "carne_estudiante"=$1 LIMIT 1`,
        [String(carne_estudiante)]
      );
      if (s1.rows.length) promedio = Number(s1.rows[0].promedio) || 0;
    } catch {}

    const std0 = (await getClosestStandard(Number(id_materia), promedio)) || { id_estandar: null, Valor: 0 };

    // IA (fallback SQL si falla)
    let firstQ = null;
    try {
      const rankRes = await IA.rank({
        id_materia: Number(id_materia),
        target_valor: Number(std0.Valor),
        exclude: [],
        k: 1,
      });
      firstQ = rankRes?.items?.[0] || null;
    } catch (e) {
      warn("IA.rank falló; fallback SQL:", e.message);
    }
    if (!firstQ) {
      const { rows } = await db.query(
        `
        SELECT p."id_pregunta", p."enunciado", e."Valor"::numeric AS valor_estandar
        FROM "Pregunta" p
        JOIN "Estandar" e ON e."id_estandar"=p."id_estandar"
        JOIN "Tema" t ON t."id_tema"=e."id_tema"
        JOIN "Area" a ON a."id_area"=t."id_area"
        WHERE a."id_materia"=$1
        ORDER BY ABS(e."Valor"::numeric - $2::numeric) ASC, p."id_pregunta" ASC
        LIMIT 1
        `,
        [Number(id_materia), Number(std0.Valor || 0)]
      );
      if (!rows.length) return res.status(400).json({ ok:false, msg:"No se encontró una pregunta inicial." });
      firstQ = { id_pregunta: Number(rows[0].id_pregunta), enunciado: rows[0].enunciado };
    }

    // crea evaluación (id_sesion solo si es válido; ya verificado arriba)
    const id_evaluacion = await createEvaluacionFlex({
      carne_est: String(carne_estudiante),
      id_materia: Number(id_materia),
      id_sesion: id_sesion, // <-- importante: nada de 0 por defecto
    });

    // registra primera pregunta mostrada
    const { rows: cRows } = await db.query(
      `SELECT COUNT(1) AS c FROM "Detalle_evaluacion" WHERE "id_evaluacion"=$1`,
      [id_evaluacion]
    );
    const nextOrder = Number(cRows[0].c) + 1;
    const dif = Number(std0.Valor || 0);

    await db.query(
      `
      INSERT INTO "Detalle_evaluacion"
        ("id_evaluacion","id_pregunta","orden","dificultad_mostrada","presentado_en","theta_previo","theta_posterior")
      VALUES ($1,$2,$3,$4, NOW(), $5, $6)
      `,
      [id_evaluacion, Number(firstQ.id_pregunta), nextOrder, dif, 0, 0]
    );

    const opciones  = await loadOptionsFromDB(Number(firstQ.id_pregunta));
    const enunciado = firstQ.enunciado || (await getEnunciado(Number(firstQ.id_pregunta)));

    return res.json({
      ok: true,
      id_evaluacion,
      valor_estandar: Number(std0.Valor || 0),
      question: {
        id_pregunta: Number(firstQ.id_pregunta),
        enunciado,
        opciones,
      },
      num_preg_max: Number(num_preg_max || 10),
    });
  } catch (err) {
    warn("start error:", err);
    const msg = err?.data?.msg || err?.msg || err.message || "No se pudo iniciar la sesión.";
    res.status(err.status || 500).json({ ok:false, msg });
  }
}

/**
 * POST /api/adaptative/session/:id/answer
 * Acepta:
 *  - params.id como id_evaluacion  (modo antiguo)
 *  - o body.evaluacionId/id_evaluacion (modo nuevo)
 * Body: { id_pregunta, id_opcion, id_materia, valor_estandar_actual, tiempo_respuesta }
 */
async function submitAnswer(req, res) {
  try {
    const id_evaluacion = Number(
      req.body?.evaluacionId ??
      req.body?.id_evaluacion ??
      req.params?.id
    );

    const { id_pregunta, id_opcion, id_materia, valor_estandar_actual, tiempo_respuesta } = req.body;

    if (!id_evaluacion) {
      return res.status(400).json({ ok:false, msg:"evaluacionId requerido." });
    }
    if (!id_pregunta || !id_opcion || !id_materia) {
      return res.status(400).json({ ok:false, msg:"Faltan campos: id_pregunta, id_opcion, id_materia" });
    }

    const pid = Number(id_pregunta);
    const oid = Number(id_opcion);

    const correcta = await isOptionCorrect(oid, pid);

    // guarda respuesta si el esquema lo permite
    try {
      if (await hasColumns("Respuesta", ["id_evaluacion","id_pregunta","id_opcion"])) {
        await db.query(
          `
          INSERT INTO "Respuesta"
            ("id_evaluacion","id_pregunta","id_opcion","correcta","tiempo_respuesta")
          VALUES ($1,$2,$3,$4,$5)
          `,
          [ id_evaluacion, pid, oid, correcta, Number(tiempo_respuesta || 0) ]
        );
      }
    } catch {}

    // mover dificultad (2 seguidas bien -> sube, 2 seguidas mal -> baja)
    let twoRight=false, twoWrong=false;
    try {
      const { rows } = await db.query(
        `SELECT "correcta" FROM "Respuesta" WHERE "id_evaluacion"=$1 ORDER BY "id_respuesta" DESC LIMIT 2`,
        [id_evaluacion]
      );
      const s = rows.map(r => r.correcta === true);
      twoRight = s.length === 2 && s.every(Boolean);
      twoWrong = s.length === 2 && s.every(v => v === false);
    } catch {}

    let currentValor = (valor_estandar_actual != null)
      ? Number(valor_estandar_actual)
      : (await getValorFromPregunta(pid)) ?? 0;

    const dir = twoRight ? "up" : twoWrong ? "down" : "stay";
    const stdNext = dir === "stay"
      ? { id_estandar:null, Valor: currentValor }
      : await stepStandard(Number(id_materia), currentValor, dir);
    const targetValor = Number(stdNext.Valor || currentValor);

    const exclude = await getAskedQuestionIds(id_evaluacion);

    let nextQ = null;
    try {
      const rankRes = await IA.rank({
        id_materia: Number(id_materia),
        target_valor: targetValor,
        exclude,
        k: 1,
      });
      nextQ = rankRes?.items?.[0] || null;
    } catch {}

    if (!nextQ) {
      const { rows } = await db.query(
        `
        SELECT p."id_pregunta", p."enunciado", e."Valor"::numeric AS valor_estandar
        FROM "Pregunta" p
        JOIN "Estandar" e ON e."id_estandar"=p."id_estandar"
        JOIN "Tema" t ON t."id_tema"=e."id_tema"
        JOIN "Area" a ON a."id_area"=t."id_area"
        WHERE a."id_materia"=$1
          AND (COALESCE($3::int[], '{}')='{}' OR NOT (p."id_pregunta" = ANY($3)))
        ORDER BY ABS(e."Valor"::numeric - $2::numeric) ASC, p."id_pregunta" ASC
        LIMIT 1
        `,
        [Number(id_materia), targetValor, exclude.length ? exclude : null]
      );
      if (rows.length) nextQ = { id_pregunta: Number(rows[0].id_pregunta), enunciado: rows[0].enunciado };
    }

    if (!nextQ) {
      try { await db.query(`UPDATE "Evaluacion" SET "fecha_final"=NOW() WHERE "id_evaluacion"=$1`, [id_evaluacion]); } catch {}
      return res.json({ ok:true, correcta, finished:true, question:null });
    }

    const { rows: cRows } = await db.query(
      `SELECT COUNT(1) AS c FROM "Detalle_evaluacion" WHERE "id_evaluacion"=$1`,
      [id_evaluacion]
    );
    const nextOrder = Number(cRows[0].c) + 1;

    await db.query(
      `
      INSERT INTO "Detalle_evaluacion"
        ("id_evaluacion","id_pregunta","orden","dificultad_mostrada","presentado_en","theta_previo","theta_posterior")
      VALUES ($1,$2,$3,$4, NOW(), $5, $6)
      `,
      [id_evaluacion, Number(nextQ.id_pregunta), nextOrder, targetValor, 0, 0]
    );

    const opciones  = await loadOptionsFromDB(Number(nextQ.id_pregunta));
    const enunciado = nextQ.enunciado || (await getEnunciado(Number(nextQ.id_pregunta)));

    return res.json({
      ok: true,
      correcta,
      question: {
        id_pregunta: Number(nextQ.id_pregunta),
        enunciado,
        opciones,
      },
      valor_estandar: targetValor,
    });
  } catch (err) {
    warn("answer error:", err);
    const msg = err?.data?.msg || err?.msg || err.message || "No se pudo obtener la siguiente pregunta.";
    res.status(err.status || 500).json({ ok:false, msg });
  }
}

async function endSession(req, res) {
  try {
    const id_evaluacion = Number(req.params.id);
    await db.query(`UPDATE "Evaluacion" SET "fecha_final"=NOW() WHERE "id_evaluacion"=$1`, [id_evaluacion]);
    return res.json({ ok:true, ended:true });
  } catch (err) {
    warn("end error:", err);
    res.status(500).json({ ok:false, msg: err.message || "Error al finalizar sesión" });
  }
}

module.exports = {
  startSession,
  submitAnswer,
  endSession,
};
