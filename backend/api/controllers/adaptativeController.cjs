// backend/api/controllers/adaptativeController.cjs
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
   Helpers de sesión/evaluación (modos)
================================== */

async function getSesionCfgByEvaluacion(id_evaluacion) {
  const { rows } = await db.query(
    `
    SELECT se."id_sesion",
           se."num_preg_max",
           se."tiempo_limite_seg",
           se."estado",
           se."iniciado_en"
    FROM "Evaluacion" ev
    JOIN "Sesion_evaluacion" se ON se."id_sesion" = ev."id_sesion"
    WHERE ev."id_evaluacion" = $1
    `,
    [Number(id_evaluacion)]
  );
  return rows[0] || null;
}
async function getSesionCfgById(id_sesion) {
  const { rows } = await db.query(
    `
    SELECT se."id_sesion",
           se."num_preg_max",
           se."tiempo_limite_seg",
           se."estado",
           se."iniciado_en"
    FROM "Sesion_evaluacion" se
    WHERE se."id_sesion" = $1
    `,
    [Number(id_sesion)]
  );
  return rows[0] || null;
}
async function markSesionStartedIfNeeded(id_sesion) {
  if (!Number.isFinite(Number(id_sesion))) return;
  const { rows } = await db.query(
    `SELECT "tiempo_limite_seg","iniciado_en" FROM "Sesion_evaluacion" WHERE "id_sesion"=$1`,
    [Number(id_sesion)]
  );
  if (!rows.length) return;
  const { tiempo_limite_seg, iniciado_en } = rows[0];
  if (tiempo_limite_seg != null && Number(tiempo_limite_seg) > 0 && !iniciado_en) {
    await db.query(
      `UPDATE "Sesion_evaluacion" SET "iniciado_en" = NOW() WHERE "id_sesion"=$1`,
      [Number(id_sesion)]
    );
  }
}
async function closeEvaluacionIfPossible(id_evaluacion) {
  try {
    const cols = await tableColumns("Evaluacion");
    const hasFechaFinal = cols.some(c => c.name === "fecha_final");
    if (hasFechaFinal) {
      await db.query(
        `UPDATE "Evaluacion" SET "fecha_final" = NOW() WHERE "id_evaluacion"=$1`,
        [Number(id_evaluacion)]
      );
    }
  } catch (e) {
    warn("closeEvaluacionIfPossible:", e.message);
  }
}

/* ==================================
   Helpers de dominio
================================== */

// Preferimos Pregunta.valor (o similares) si existe; si no, Estandar.Valor
async function getPreguntaValorColumn() {
  const cols = await tableColumns("Pregunta");
  const cands = ["valor", "Valor", "valor_pregunta", "puntaje", "peso"];
  for (const c of cands) {
    const hit = cols.find(x => x.name.toLowerCase() === c.toLowerCase());
    if (hit) return hit.name;
  }
  return null;
}

// Valor que usaremos para cálculos (del ítem)
async function getValorFromPregunta(id_pregunta) {
  const pValCol = await getPreguntaValorColumn();
  if (pValCol) {
    const { rows } = await db.query(
      `SELECT "${pValCol}"::numeric AS v FROM "Pregunta" WHERE "id_pregunta"=$1`,
      [Number(id_pregunta)]
    );
    if (rows.length) return rows[0].v != null ? Number(rows[0].v) : null;
  }
  const { rows } = await db.query(
    `
    SELECT e."Valor"::numeric AS v
    FROM "Pregunta" p
    JOIN "Estandar" e ON e."id_estandar"=p."id_estandar"
    WHERE p."id_pregunta"=$1
    `,
    [Number(id_pregunta)]
  );
  return rows.length ? Number(rows[0].v) : null;
}

// estándar más cercano al target (para navegar dificultad)
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

// siguiente/prev estándar (navegación)
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

// Enunciado desde BD
async function getEnunciado(id_pregunta) {
  const { rows } = await db.query(
    `SELECT "enunciado" FROM "Pregunta" WHERE "id_pregunta"=$1`,
    [id_pregunta]
  );
  return rows.length ? String(rows[0].enunciado) : "Enunciado no disponible";
}

// Opciones desde BD (tolerante a nombres)
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

  // Fallback genérico
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

/* ==================================
   Helpers de ÁREAS para balanceo
================================== */

async function getAreasForMateria(id_materia) {
  const { rows } = await db.query(
    `SELECT a."id_area"
     FROM "Area" a
     WHERE a."id_materia"=$1
     ORDER BY a."id_area" ASC`,
    [Number(id_materia)]
  );
  return rows.map(r => Number(r.id_area));
}
async function getAreaIdFromPregunta(id_pregunta) {
  const { rows } = await db.query(
    `
    SELECT a."id_area"
    FROM "Pregunta" p
    JOIN "Estandar" e ON e."id_estandar" = p."id_estandar"
    JOIN "Tema"     t ON t."id_tema"     = e."id_tema"
    JOIN "Area"     a ON a."id_area"     = t."id_area"
    WHERE p."id_pregunta"=$1
    LIMIT 1
    `,
    [Number(id_pregunta)]
  );
  return rows.length ? Number(rows[0].id_area) : null;
}
async function getAreaNameById(id_area) {
  try {
    const cols = await tableColumns("Area");
    if (!cols.length) return null;
    const set = new Set(cols.map(c => c.name.toLowerCase()));
    const pick = (...cands) => {
      for (const c of cands) if (set.has(c)) return cols.find(x => x.name.toLowerCase()===c).name;
      return null;
    };
    const nameCol = pick("nombre_area","nombre","descripcion","descripcion_area","titulo");
    if (!nameCol) return null;
    const { rows } = await db.query(
      `SELECT "${nameCol}" AS nombre FROM "Area" WHERE "id_area"=$1 LIMIT 1`,
      [Number(id_area)]
    );
    return rows.length ? String(rows[0].nombre) : null;
  } catch { return null; }
}
async function getAreaCountsForEval(id_evaluacion) {
  const { rows } = await db.query(
    `
    SELECT a."id_area", COUNT(*)::int AS c
    FROM "Detalle_evaluacion" d
    JOIN "Pregunta"  p ON p."id_pregunta" = d."id_pregunta"
    JOIN "Estandar"  e ON e."id_estandar" = p."id_estandar"
    JOIN "Tema"      t ON t."id_tema"     = e."id_tema"
    JOIN "Area"      a ON a."id_area"     = t."id_area"
    WHERE d."id_evaluacion"=$1
    GROUP BY a."id_area"
    `,
    [Number(id_evaluacion)]
  );
  const map = {};
  for (const r of rows) map[Number(r.id_area)] = Number(r.c);
  return map;
}
async function getPreferAreasBalanced(id_evaluacion, id_materia) {
  const all = await getAreasForMateria(id_materia);
  if (!all.length) return [];
  const counts = id_evaluacion ? await getAreaCountsForEval(id_evaluacion) : {};
  let min = Infinity;
  for (const a of all) min = Math.min(min, counts[a] ?? 0);
  return all.filter(a => (counts[a] ?? 0) === min);
}
async function pickNextQuestionBalanced({ id_materia, targetValor, exclude = [], preferAreas = [] }) {
  const tryPick = async (areasFilter) => {
    const { rows } = await db.query(
      `
      SELECT p."id_pregunta", p."enunciado", a."id_area"
      FROM "Pregunta" p
      JOIN "Estandar" e ON e."id_estandar" = p."id_estandar"
      JOIN "Tema"     t ON t."id_tema"     = e."id_tema"
      JOIN "Area"     a ON a."id_area"     = t."id_area"
      WHERE a."id_materia" = $1
        AND NOT (p."id_pregunta" = ANY($3))
        AND ($4::int[] IS NULL OR a."id_area" = ANY($4))
      ORDER BY ABS(e."Valor"::numeric - $2::numeric) ASC, random()
      LIMIT 1
      `,
      [ Number(id_materia), Number(targetValor || 0), (exclude.length ? exclude : [0]), (areasFilter && areasFilter.length ? areasFilter : null) ]
    );
    return rows.length ? { id_pregunta: Number(rows[0].id_pregunta), enunciado: rows[0].enunciado, id_area: Number(rows[0].id_area) } : null;
  };
  let q = await tryPick(preferAreas);
  if (!q) q = await tryPick(null);
  return q;
}

/* ==================================
   Matriculación / Evaluación
================================== */

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
  // Fallback vía sesiones
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

  // 3) crear matrícula
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
  } else if (eSet.has("id_grado")) {
    const gRes = await db.query(
      `SELECT "id_grado" FROM "Estudiantes" WHERE "carne_estudiante"=$1 LIMIT 1`,
      [carne]
    );
    if (gRes.rows.length) {
      id_grado_val = gRes.rows[0].id_grado != null ? Number(gRes.rows[0].id_grado) : null;
    }
  }

  const required = mCols.filter(c => c.required).map(c => c.name.toLowerCase());
  let id_clase_val = null;

  if (mSet.has("id_clase") && required.includes("id_clase")) {
    id_clase_val = await findClaseIdFor(id_grado_val, Number(id_materia));
    if (id_clase_val == null) {
      throw Object.assign(new Error("No se encontró una clase para el grado del estudiante y la materia."), { status: 400 });
    }
  }

  const now = new Date();
  const values = {};
  const canUse = (n) => mSet.has(String(n).toLowerCase()); // sin await

  if (canUse("id_estudiante") && id_estudiante_val != null) values.id_estudiante = id_estudiante_val;
  if (canUse("id_temporada") && temporadaId != null) values.id_temporada = temporadaId;
  if (canUse("id_grado") && id_grado_val != null) values.id_grado = id_grado_val;
  if (canUse("carne_estudiante")) values.carne_estudiante = carne;
  if (canUse("carne_est")) values.carne_est = carne;
  if (canUse("id_clase") && id_clase_val != null) values.id_clase = id_clase_val;
  if (canUse("fecha_alta")) values.fecha_alta = now;
  else if (canUse("fecha_matricula")) values.fecha_matricula = now;

  const missing = required.filter(r => values[r] === undefined);
  if (missing.length) {
    throw Object.assign(new Error(`No se pudo crear la matrícula: faltan columnas obligatorias (${missing.join(", ")}).`), { status: 400 });
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
  if (set.has("id_sesion") && Number.isFinite(Number(id_sesion)) && (await existsSesion(id_sesion))) {
    values.id_sesion = Number(id_sesion);
  }

  const missing = cols
    .filter(c => c.required)
    .map(c => c.name)
    .filter(n => values[n] === undefined);

  if (missing.length) {
    throw Object.assign(new Error(`No se pudo crear la evaluación: faltan columnas obligatorias (${missing.join(", ")}).`), { status: 400 });
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
   Resultados por área (RIT = promedio del valor del ÍTEM acertado)
================================== */

async function getAreaResults(id_evaluacion) {
  const hasResp = await hasColumns("Respuesta", ["id_evaluacion","id_pregunta","correcta"]);
  if (!hasResp) return [];

  const aCols = await tableColumns("Area");
  if (!aCols.length) return [];
  const findCol = (cands) => {
    const set = new Set(aCols.map(c => c.name.toLowerCase()));
    for (const c of cands) if (set.has(c.toLowerCase())) return aCols.find(x => x.name.toLowerCase()===c).name;
    return null;
  };
  const aId   = findCol(["id_area"]) || "id_area";
  const aName = findCol(["nombre_area","nombre","Nombre","descripcion","descripcion_area","titulo"]) || "id_area";

  const pValCol = await getPreguntaValorColumn();
  const valueExpr = pValCol ? `p."${pValCol}"::numeric` : `e."Valor"::numeric`;

  const sql = `
    WITH items AS (
      SELECT
        r."id_evaluacion",
        r."correcta",
        ${valueExpr} AS v,
        a."${aId}"   AS id_area,
        a."${aName}" AS nombre
      FROM "Respuesta" r
      JOIN "Pregunta" p ON p."id_pregunta" = r."id_pregunta"
      JOIN "Estandar" e ON e."id_estandar" = p."id_estandar"
      JOIN "Tema"     t ON t."id_tema"     = e."id_tema"
      JOIN "Area"     a ON a."id_area"     = t."id_area"
      WHERE r."id_evaluacion" = $1
    ),
    area_bounds AS (
      SELECT id_area, COALESCE(MIN(v),0) AS minv, COALESCE(MAX(v),20) AS maxv
      FROM items
      GROUP BY id_area
    )
    SELECT
      i.id_area,
      i.nombre,
      COUNT(*)::int AS total,
      SUM(CASE WHEN i."correcta"=true THEN 1 ELSE 0 END)::int AS correctas,
      COALESCE(AVG(i.v) FILTER (WHERE i."correcta"=true), 0) AS rit_raw,
      ab.minv AS minv,
      ab.maxv AS maxv
    FROM items i
    JOIN area_bounds ab ON ab.id_area = i.id_area
    GROUP BY i.id_area, i.nombre, ab.minv, ab.maxv
    ORDER BY i.nombre ASC
  `;
  const { rows } = await db.query(sql, [Number(id_evaluacion)]);

  const toLevel = (rit, maxv) => {
    const q = maxv > 0 ? (rit / maxv) : 0;
    return q >= 0.85 ? "avanzado"
         : q >= 0.65 ? "satisfactorio"
         : q >= 0.40 ? "en_proceso"
         : "inicial";
  };

  return rows.map(r => {
    const total     = Number(r.total) || 0;
    const correctas = Number(r.correctas) || 0;
    const pct       = total > 0 ? (correctas / total) : 0;

    const maxv = Number(r.maxv) || 20;
    let rit    = Number(r.rit_raw) || 0;

    rit = Math.max(0, Math.min(maxv, rit));
    const ritRounded = Number(rit.toFixed(1));

    return {
      id_area: Number(r.id_area),
      nombre:  String(r.nombre ?? r.id_area),
      total,
      correctas,
      pct: Number((pct * 100).toFixed(1)),
      rit: ritRounded,   // promedio del valor del ítem (solo aciertos)
      nivel: toLevel(rit, maxv),
    };
  });
}

/* ==================================
   Resumen (promedio general y por área)
================================== */

function summarizeAreas(areas = []) {
  const toNum = (v) => Number(v ?? 0);

  const total = areas.reduce((a, x) => a + toNum(x.total), 0);
  const correctas = areas.reduce((a, x) => a + toNum(x.correctas), 0);
  const pct_global = total > 0 ? Number(((correctas / total) * 100).toFixed(1)) : 0;

  const rit_prom = total > 0
    ? Number((areas.reduce((a, x) => a + toNum(x.rit) * toNum(x.total), 0) / total).toFixed(1))
    : 0;

  const nAreas = areas.length;
  const avgFracArea = nAreas > 0
    ? areas.reduce((a, x) => {
        const t = toNum(x.total);
        const c = toNum(x.correctas);
        return a + (t > 0 ? (c / t) : 0);
      }, 0) / nAreas
    : 0;
  const pct_area_prom = Number((avgFracArea * 100).toFixed(1));
  const rit_area_prom = nAreas > 0
    ? Number((areas.reduce((a, x) => a + toNum(x.rit), 0) / nAreas).toFixed(1))
    : 0;

  return { total, correctas, pct_global, rit_prom, pct_area_prom, rit_area_prom };
}

/* ==================================
   Persistencias
================================== */

async function ensureResumenTableExists() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS "Resumen_evaluacion" (
        "id_evaluacion" INTEGER PRIMARY KEY REFERENCES "Evaluacion"("id_evaluacion") ON DELETE CASCADE,
        "total" INTEGER,
        "correctas" INTEGER,
        "pct_global" NUMERIC(5,1),
        "rit_prom" NUMERIC(6,1),
        "pct_area_prom" NUMERIC(5,1),
        "rit_area_prom" NUMERIC(6,1),
        "updated_at" TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.query(`ALTER TABLE "Resumen_evaluacion" ADD COLUMN IF NOT EXISTS "pct_area_prom" NUMERIC(5,1)`);
    await db.query(`ALTER TABLE "Resumen_evaluacion" ADD COLUMN IF NOT EXISTS "rit_area_prom" NUMERIC(6,1)`);
  } catch (e) {
    warn("ensureResumenTableExists:", e.message);
  }
}
function findRealCol(cols, lowerName) {
  const hit = cols.find(c => c.name.toLowerCase() === lowerName);
  return hit ? hit.name : null;
}
async function saveSummaryForEvaluacion(id_evaluacion, summary) {
  try {
    try {
      const eCols = await tableColumns("Evaluacion");
      const set = new Set(eCols.map(c => c.name.toLowerCase()));
      const updPairs = [];
      const params = [];
      let i = 1;
      const addIf = (cands, val) => {
        for (const c of cands) {
          if (set.has(c)) {
            const real = findRealCol(eCols, c);
            if (real) {
              updPairs.push(`"${real}" = $${i++}`);
              params.push(val);
              return true;
            }
          }
        }
        return false;
      };
      addIf(["pct_global","promedio_global","porcentaje_global","porcentaje_aciertos"], summary.pct_global);
      addIf(["rit_prom","rit_promedio","promedio_rit"], summary.rit_prom);
      addIf(["total_preguntas","total","n_preguntas"], summary.total);
      addIf(["correctas","respuestas_correctas","aciertos"], summary.correctas);
      addIf(["pct_area_prom","promedio_area","porcentaje_area","porcentaje_area_promedio"], summary.pct_area_prom);
      addIf(["rit_area_prom","rit_prom_area","promedio_rit_area"], summary.rit_area_prom);

      if (set.has("resumen") || set.has("summary_json")) {
        const target = set.has("resumen") ? findRealCol(eCols,"resumen") : findRealCol(eCols,"summary_json");
        try {
          await db.query(
            `UPDATE "Evaluacion" SET "${target}" = $1::jsonb WHERE "id_evaluacion"=$2`,
            [JSON.stringify(summary), Number(id_evaluacion)]
          );
        } catch {
          try {
            await db.query(
              `UPDATE "Evaluacion" SET "${target}" = $1 WHERE "id_evaluacion"=$2`,
              [JSON.stringify(summary), Number(id_evaluacion)]
            );
          } catch (e2) { warn("Guardar resumen JSON en Evaluacion:", e2.message); }
        }
      }
      if (updPairs.length) {
        params.push(Number(id_evaluacion));
        const sql = `UPDATE "Evaluacion" SET ${updPairs.join(", ")} WHERE "id_evaluacion"=$${i}`;
        await db.query(sql, params);
      }
    } catch (e) { warn("saveSummary Evaluacion:", e.message); }

    await ensureResumenTableExists();
    try {
      await db.query(
        `
        INSERT INTO "Resumen_evaluacion"
          ("id_evaluacion","total","correctas","pct_global","rit_prom","pct_area_prom","rit_area_prom","updated_at")
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT ("id_evaluacion")
        DO UPDATE SET
          "total"=EXCLUDED."total",
          "correctas"=EXCLUDED."correctas",
          "pct_global"=EXCLUDED."pct_global",
          "rit_prom"=EXCLUDED."rit_prom",
          "pct_area_prom"=EXCLUDED."pct_area_prom",
          "rit_area_prom"=EXCLUDED."rit_area_prom",
          "updated_at"=NOW()
        `,
        [
          Number(id_evaluacion),
          Number(summary.total||0),
          Number(summary.correctas||0),
          Number(summary.pct_global||0),
          Number(summary.rit_prom||0),
          Number(summary.pct_area_prom||0),
          Number(summary.rit_area_prom||0),
        ]
      );
    } catch (e) { warn("upsert Resumen_evaluacion:", e.message); }
  } catch (e) { warn("saveSummaryForEvaluacion (general):", e.message); }
}

async function ensureSnapshotAreaTableExists() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS "snapshot_promedio_area" (
        "id_snapshot"    BIGSERIAL PRIMARY KEY,
        "id_evaluacion"  BIGINT NOT NULL,
        "id_area"        BIGINT NOT NULL,
        "promedio_area"  NUMERIC(5,2) NOT NULL,
        CONSTRAINT "evaluacion_area_uniq" UNIQUE ("id_evaluacion","id_area"),
        CONSTRAINT "snapshot_area" FOREIGN KEY ("id_area") REFERENCES "Area"("id_area")
      );
    `);
  } catch (e) {
    warn("ensureSnapshotAreaTableExists:", e.message);
  }
}
async function saveAreaSnapshots(id_evaluacion, areas = []) {
  try {
    await ensureSnapshotAreaTableExists();
    for (const a of areas) {
      const total = Number(a.total) || 0;
      if (total <= 0) continue;
      const prom = Number((Number(a.rit) || 0).toFixed(2)); // RIT del área (valor del ítem)
      await db.query(
        `
        INSERT INTO "snapshot_promedio_area"
          ("id_evaluacion","id_area","promedio_area")
        VALUES ($1,$2,$3)
        ON CONFLICT ("id_evaluacion","id_area")
        DO UPDATE SET "promedio_area"=EXCLUDED."promedio_area"
        `,
        [ Number(id_evaluacion), Number(a.id_area), prom ]
      );
    }
  } catch (e) {
    warn("saveAreaSnapshots:", e.message);
  }
}

/* ==================================
   Endpoints
================================== */

async function startSession(req, res) {
  try {
    const { carne_estudiante, id_materia, num_preg_max } = req.body;
    log("POST /session/start body =", req.body);

    // Resolver id_sesion
    let id_sesion =
      req.body?.id_sesion ??
      req.body?.sessionId ??
      req.query?.id_sesion ??
      req.query?.sessionId ??
      req.params?.id_sesion ??
      req.params?.id;

    if (!(await existsSesion(id_sesion))) id_sesion = null;

    // promedio estudiante (si lo hay)
    let promedio = 0;
    try {
      const s1 = await db.query(
        `SELECT "promedio" FROM "Estudiantes" WHERE "carne_estudiante"=$1 LIMIT 1`,
        [String(carne_estudiante)]
      );
      if (s1.rows.length) promedio = Number(s1.rows[0].promedio) || 0;
    } catch {}

    const std0 = (await getClosestStandard(Number(id_materia), promedio)) || { id_estandar: null, Valor: 0 };

    // Primera pregunta balanceada
    const firstQ = await pickNextQuestionBalanced({
      id_materia: Number(id_materia),
      targetValor: Number(std0.Valor || 0),
      exclude: [],
      preferAreas: await getAreasForMateria(Number(id_materia)),
    });
    if (!firstQ) {
      return res.status(400).json({ ok:false, msg:"No se encontró una pregunta inicial." });
    }

    // crear evaluación
    const id_evaluacion = await createEvaluacionFlex({
      carne_est: String(carne_estudiante),
      id_materia: Number(id_materia),
      id_sesion: id_sesion,
    });

    // activar reloj si aplica
    try {
      if (Number.isFinite(Number(id_sesion))) {
        await markSesionStartedIfNeeded(id_sesion);
      }
    } catch (e) { warn("markSesionStartedIfNeeded:", e.message); }

    // registrar primera pregunta
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
    const valorItem = await getValorFromPregunta(Number(firstQ.id_pregunta));

    let areaNombre = null;
    try { areaNombre = await getAreaNameById(Number(firstQ.id_area)); } catch {}

    return res.json({
      ok: true,
      id_evaluacion,
      valor_estandar: Number(std0.Valor || 0),
      question: {
        id_pregunta: Number(firstQ.id_pregunta),
        enunciado,
        opciones,
        id_area: Number(firstQ.id_area ?? 0) || null,
        area: areaNombre || null,
        valor: Number(valorItem ?? 0), // ← ÚNICO valor mostrado/usado en UI
      },
      num_preg_max: Number(num_preg_max ?? 10),
    });
  } catch (err) {
    warn("start error:", err);
    const msg = err?.data?.msg || err?.msg || err.message || "No se pudo iniciar la sesión.";
    res.status(err.status || 500).json({ ok:false, msg });
  }
}

/**
 * POST /api/adaptative/session/:id/answer
 * Body: { id_pregunta, id_opcion, id_materia, valor_estandar_actual, tiempo_respuesta, [num_preg_max] }
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

    // guardar respuesta
    try {
      const respHasBase = await hasColumns("Respuesta", ["id_evaluacion","id_pregunta","id_opcion"]);
      if (respHasBase) {
        const colsResp = await tableColumns("Respuesta");
        const colSet   = new Set(colsResp.map(c => c.name.toLowerCase()));
        const hasCorrecta = colSet.has("correcta");
        const hasTiempo   = colSet.has("tiempo_respuesta");

        if (hasCorrecta && hasTiempo) {
          const sec = Math.max(0, Number(tiempo_respuesta || 0));
          const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
          const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
          const ss = String(Math.floor(sec % 60)).padStart(2, "0");
          const timeStr = `${hh}:${mm}:${ss}`;

          await db.query(
            `
            INSERT INTO "Respuesta"
              ("id_evaluacion","id_pregunta","id_opcion","correcta","tiempo_respuesta")
            VALUES ($1,$2,$3,$4,$5::time)
            `,
            [ id_evaluacion, pid, oid, correcta, timeStr ]
          );
        } else if (hasCorrecta) {
          await db.query(
            `
            INSERT INTO "Respuesta"
              ("id_evaluacion","id_pregunta","id_opcion","correcta")
            VALUES ($1,$2,$3,$4)
            `,
            [ id_evaluacion, pid, oid, correcta ]
          );
        } else {
          await db.query(
            `
            INSERT INTO "Respuesta"
              ("id_evaluacion","id_pregunta","id_opcion")
            VALUES ($1,$2,$3)
            `,
            [ id_evaluacion, pid, oid ]
          );
        }
      }
    } catch (e) {
      warn("INSERT Respuesta falló:", e.message);
    }

    // modos
    let cfg = null;
    try { cfg = await getSesionCfgByEvaluacion(id_evaluacion); } catch (e) { warn("getSesionCfgByEvaluacion:", e.message); }

    // cierre por docente
    if (cfg?.estado && ["cerrada", "cancelada"].includes(String(cfg.estado))) {
      await closeEvaluacionIfPossible(id_evaluacion);
      const areas = await getAreaResults(id_evaluacion);
      const summary = summarizeAreas(areas);
      await saveSummaryForEvaluacion(id_evaluacion, summary);
      await saveAreaSnapshots(id_evaluacion, areas);
      return res.json({ ok: true, correcta, finished: true, reason: "sesion_cerrada", areas, summary, question: null });
    }

    // límite por tiempo
    if (cfg?.tiempo_limite_seg != null && Number(cfg.tiempo_limite_seg) > 0 && cfg?.iniciado_en) {
      const { rows: tnow } = await db.query(`SELECT NOW() as now`);
      const now = new Date(tnow[0].now);
      const started = new Date(cfg.iniciado_en);
      const elapsedSec = Math.floor((now.getTime() - started.getTime()) / 1000);
      if (elapsedSec >= Number(cfg.tiempo_limite_seg)) {
        await closeEvaluacionIfPossible(id_evaluacion);
        const areas = await getAreaResults(id_evaluacion);
        const summary = summarizeAreas(areas);
        await saveSummaryForEvaluacion(id_evaluacion, summary);
        await saveAreaSnapshots(id_evaluacion, areas);
        return res.json({ ok: true, correcta, finished: true, reason: "timeout", areas, summary, question: null });
      }
    }

    // límite por # preguntas
    let maxQ = null;
    if (cfg?.num_preg_max != null) maxQ = Number(cfg.num_preg_max);
    if (maxQ != null) {
      const { rows: cRows } = await db.query(
        `SELECT COUNT(1) AS c FROM "Detalle_evaluacion" WHERE "id_evaluacion"=$1`,
        [id_evaluacion]
      );
      const yaMostradas = Number(cRows[0].c) || 0;
      if (yaMostradas >= maxQ) {
        await closeEvaluacionIfPossible(id_evaluacion);
        const areas = await getAreaResults(id_evaluacion);
        const summary = summarizeAreas(areas);
        await saveSummaryForEvaluacion(id_evaluacion, summary);
        await saveAreaSnapshots(id_evaluacion, areas);
        return res.json({ ok:true, correcta, finished:true, reason:"max_preguntas", areas, summary, question:null });
      }
    }

    // lógica adaptativa → target (navegación)
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
      : (await getValorFromPregunta(Number(id_pregunta))) ?? 0;

    const dir = twoRight ? "up" : twoWrong ? "down" : "stay";
    const stdNext = dir === "stay"
      ? { id_estandar:null, Valor: currentValor }
      : await stepStandard(Number(id_materia), currentValor, dir);
    const targetValor = Number(stdNext.Valor || currentValor);

    const exclude = await getAskedQuestionIds(id_evaluacion);
    const preferAreas = await getPreferAreasBalanced(id_evaluacion, Number(id_materia));
    const minCountAreas = new Set(preferAreas);

    // Intento IA
    let nextQ = null;
    try {
      const rankRes = await IA.rank({
        id_materia: Number(id_materia),
        target_valor: targetValor,
        exclude,
        k: 1,
      });
      nextQ = rankRes?.items?.[0] || null;
    } catch (e) {
      warn("IA.rank falló en answer; fallback SQL:", e.message);
    }

    // balanceo por áreas
    if (nextQ) {
      try {
        const areaNext = nextQ.id_area ?? (await getAreaIdFromPregunta(Number(nextQ.id_pregunta)));
        if (!minCountAreas.has(areaNext)) {
          const balanced = await pickNextQuestionBalanced({
            id_materia: Number(id_materia),
            targetValor,
            exclude,
            preferAreas
          });
          if (balanced) nextQ = balanced;
        }
      } catch {}
    }
    if (!nextQ) {
      nextQ = await pickNextQuestionBalanced({
        id_materia: Number(id_materia),
        targetValor,
        exclude,
        preferAreas
      });
    }

    // finalizar si no hay siguiente
    if (!nextQ) {
      await closeEvaluacionIfPossible(id_evaluacion);
      const areas = await getAreaResults(id_evaluacion);
      const summary = summarizeAreas(areas);
      await saveSummaryForEvaluacion(id_evaluacion, summary);
      await saveAreaSnapshots(id_evaluacion, areas);
      return res.json({ ok:true, correcta, finished:true, areas, summary, question:null });
    }

    // registrar siguiente
    const { rows: cRows2 } = await db.query(
      `SELECT COUNT(1) AS c FROM "Detalle_evaluacion" WHERE "id_evaluacion"=$1`,
      [id_evaluacion]
    );
    const nextOrder = Number(cRows2[0].c) + 1;

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
    const valorNext = await getValorFromPregunta(Number(nextQ.id_pregunta));

    let nextAreaId = null;
    try { nextAreaId = Number(nextQ.id_area ?? (await getAreaIdFromPregunta(Number(nextQ.id_pregunta)))); } catch {}
    let nextAreaName = null;
    try { if (nextAreaId) nextAreaName = await getAreaNameById(nextAreaId); } catch {}

    return res.json({
      ok: true,
      correcta,
      question: {
        id_pregunta: Number(nextQ.id_pregunta),
        enunciado,
        opciones,
        id_area: nextAreaId ?? null,
        area: nextAreaName ?? null,
        valor: Number(valorNext ?? 0),  // ← valor del ítem siguiente
      },
      valor_estandar: targetValor,      // solo para navegación interna
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
    await closeEvaluacionIfPossible(id_evaluacion);

    const areas = await getAreaResults(id_evaluacion);
    const summary = summarizeAreas(areas);
    await saveSummaryForEvaluacion(id_evaluacion, summary);
    await saveAreaSnapshots(id_evaluacion, areas);

    return res.json({ ok:true, ended:true, areas, summary });
  } catch (err) {
    warn("end error:", err);
    res.status(500).json({ ok:false, msg: err.message || "Error al finalizar sesión" });
  }
}

async function areasByEvaluacion(req, res) {
  try {
    const id_evaluacion = Number(
      req.params?.id ??
      req.query?.evaluacionId ??
      req.query?.id_evaluacion
    );
    if (!id_evaluacion) {
      return res.status(400).json({ ok:false, msg:"id_evaluacion requerido" });
    }
    const areas = await getAreaResults(id_evaluacion);
    const summary = summarizeAreas(areas);
    return res.json({ ok:true, areas, summary });
  } catch (err) {
    warn("areasByEvaluacion error:", err);
    res.status(500).json({ ok:false, msg: err.message || "Error al obtener áreas" });
  }
}

module.exports = {
  startSession,
  submitAnswer,
  endSession,
  areasByEvaluacion,
};
