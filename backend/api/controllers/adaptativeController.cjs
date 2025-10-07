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
    `SELECT column_name, is_nullable, column_default, data_type
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [String(table)]
  );
  return rows.map(r => ({
    name: r.column_name,
    required: (r.is_nullable === "NO") && (r.column_default == null),
    hasDefault: r.column_default != null,
    type: (r.data_type || "").toLowerCase(),
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

  // Solo iniciar reloj si el límite es > 0
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

async function getAskedQuestionIds(id_evaluacion) {
  const { rows } = await db.query(
    `SELECT "id_pregunta" FROM "Detalle_evaluacion" WHERE "id_evaluacion"=$1 ORDER BY 1`,
    [id_evaluacion]
  );
  return rows.map(r => Number(r.id_pregunta));
}

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

async function getEnunciado(id_pregunta) {
  const { rows } = await db.query(
    `SELECT "enunciado" FROM "Pregunta" WHERE "id_pregunta"=$1`,
    [id_pregunta]
  );
  return rows.length ? String(rows[0].enunciado) : "Enunciado no disponible";
}

// Opciones desde BD
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

  // último recurso: introspección
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

  return false;
}

async function getTemporadaActivaId() {
  const { rows } = await db.query(
    `SELECT "id_temporada"
     FROM "Temporada"
     ORDER BY COALESCE("fecha_inicio",'1970-01-01') DESC
     LIMIT 1`
  );
  return rows.length ? Number(rows[0].id_temporada) : null;
}

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

/* ========== helpers de Respuesta (guardar) ========== */

function secsToHHMMSS(secs) {
  const s = Math.max(0, Number(secs) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(r)}`;
}

async function insertRespuesta({ id_evaluacion, id_pregunta, id_opcion, correcta, tiempo_respuesta }) {
  // introspección de columnas reales
  const cols = await tableColumns("Respuesta").catch(() => []);
  const set  = new Set(cols.map(c => c.name.toLowerCase()));

  if (!set.has("id_evaluacion") || !set.has("id_pregunta") || !set.has("id_opcion")) {
    warn(`Tabla "Respuesta" no tiene las columnas esperadas. No se guardará.`);
    return false;
  }

  const names = ["id_evaluacion", "id_pregunta", "id_opcion"];
  const vals  = [Number(id_evaluacion), Number(id_pregunta), Number(id_opcion)];

  if (set.has("correcta")) {
    names.push("correcta");
    vals.push(!!correcta);
  }

  if (set.has("tiempo_respuesta")) {
    // detectar tipo
    const c = cols.find(c => c.name.toLowerCase() === "tiempo_respuesta");
    const t = (c?.type || "").toLowerCase(); // e.g., "time without time zone" -> incluye "time"
    let valueForDB;
    if (t.includes("time")) {
      valueForDB = secsToHHMMSS(tiempo_respuesta); // 'HH:MM:SS'
    } else if (t.includes("integer") || t.includes("numeric") || t.includes("double") || t.includes("real")) {
      valueForDB = Number(tiempo_respuesta || 0);
    } else {
      // por defecto: guardo como texto 'HH:MM:SS'
      valueForDB = secsToHHMMSS(tiempo_respuesta);
    }
    names.push("tiempo_respuesta");
    vals.push(valueForDB);
  }

  const placeholders = names.map((_, i) => `$${i + 1}`);
  const sql = `
    INSERT INTO "Respuesta" (${names.map(n => `"${n}"`).join(",")})
    VALUES (${placeholders.join(",")})
    RETURNING "id_respuesta"
  `;

  try {
    const { rows } = await db.query(sql, vals);
    log(`💾 Respuesta guardada id_respuesta=${rows?.[0]?.id_respuesta || "?"} | eval=${id_evaluacion} | preg=${id_pregunta} | opcion=${id_opcion} | ${correcta ? "CORRECTA" : "INCORRECTA"}`);
    return true;
  } catch (e) {
    warn("❌ Error insertando en Respuesta:", e.message);
    return false;
  }
}

/* ==================================
   Creación de Evaluación
================================== */

async function ensureMatricula(carne_estudiante, id_materia) {
  const carne = String(carne_estudiante);

  const mCols = await tableColumns("Matricula");
  const mSet  = new Set(mCols.map(c => c.name.toLowerCase()));

  const eCols = await tableColumns("Estudiantes");
  const eSet  = new Set(eCols.map(c => c.name.toLowerCase()));

  const temporadaId = await getTemporadaActivaId();

  // 1) buscar por carne_*
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

  // 2) por id_estudiante si existe
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
  } else {
    if (eSet.has("id_grado")) {
      const gRes = await db.query(
        `SELECT "id_grado" FROM "Estudiantes" WHERE "carne_estudiante"=$1 LIMIT 1`,
        [carne]
      );
      if (gRes.rows.length) id_grado_val = gRes.rows[0].id_grado != null ? Number(gRes.rows[0].id_grado) : null;
    }
  }

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
  const values = {};
  const canUse = (n) => mSet.has(n.toLowerCase());

  if (canUse("id_estudiante") && id_estudiante_val != null) values.id_estudiante = id_estudiante_val;
  if (canUse("id_temporada")) {
    const temporadaId = await getTemporadaActivaId();
    if (temporadaId != null) values.id_temporada = temporadaId;
  }
  if (canUse("id_grado") && id_grado_val != null) values.id_grado = id_grado_val;
  if (canUse("carne_estudiante")) values.carne_estudiante = carne;
  if (canUse("carne_est")) values.carne_est = carne;
  if (canUse("id_clase") && id_clase_val != null) values.id_clase = id_clase_val;
  if (canUse("fecha_alta")) values.fecha_alta = now;
  else if (canUse("fecha_matricula")) values.fecha_matricula = now;

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

async function getTemporadaActivaId() {
  const { rows } = await db.query(
    `SELECT "id_temporada"
     FROM "Temporada"
     ORDER BY COALESCE("fecha_inicio",'1970-01-01') DESC
     LIMIT 1`
  );
  return rows.length ? Number(rows[0].id_temporada) : null;
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

    let id_sesion =
      req.body?.id_sesion ??
      req.body?.sessionId ??
      req.query?.id_sesion ??
      req.query?.sessionId ??
      req.params?.id_sesion ??
      req.params?.id;

    if (!(await existsSesion(id_sesion))) {
      id_sesion = null; // evita FK inválida
    }

    let promedio = 0;
    try {
      const s1 = await db.query(
        `SELECT "promedio" FROM "Estudiantes" WHERE "carne_estudiante"=$1 LIMIT 1`,
        [String(carne_estudiante)]
      );
      if (s1.rows.length) promedio = Number(s1.rows[0].promedio) || 0;
    } catch {}

    const std0 = (await getClosestStandard(Number(id_materia), promedio)) || { id_estandar: null, Valor: 0 };

    // 1ra pregunta
    let firstQ = null;
    try {
      const rankRes = await IA.rank({
        id_materia: Number(id_materia),
        target_valor: Number(std0.Valor),
        exclude: [],
        k: 1,
      });
      firstQ = rankRes?.items?.[0] || null;
    } catch (e) { warn("IA.rank falló; fallback SQL:", e.message); }
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

    // crea evaluación
    const id_evaluacion = await createEvaluacionFlex({
      carne_est: String(carne_estudiante),
      id_materia: Number(id_materia),
      id_sesion: id_sesion,
    });

    // reloj (solo si hay límite tiempo > 0)
    try {
      if (Number.isFinite(Number(id_sesion))) {
        await markSesionStartedIfNeeded(id_sesion);
      }
    } catch (e) { warn("markSesionStartedIfNeeded:", e.message); }

    // registrar primera pregunta mostrada
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

    // límites efectivos
    let cfg = null;
    try {
      if (Number.isFinite(Number(id_sesion))) cfg = await getSesionCfgById(id_sesion);
    } catch (e) { warn("getSesionCfgById:", e.message); }

    const cfgMax  = Number(cfg?.num_preg_max);
    const bodyMax = Number(num_preg_max);
    const effectiveMax =
      (Number.isFinite(cfgMax)  && cfgMax  > 0) ? cfgMax  :
      (Number.isFinite(bodyMax) && bodyMax > 0) ? bodyMax : null;

    log(`▶️ Evaluación ${id_evaluacion} iniciada (sesión=${id_sesion ?? "—"})`);
    log(`   Límites: preguntas=${effectiveMax ?? "∞"} | tiempo=${(cfg && Number(cfg.tiempo_limite_seg) > 0) ? cfg.tiempo_limite_seg+"s" : "—"}`);
    log(`🟦 Q#${nextOrder} mostrada -> preg=${firstQ.id_pregunta}, valor=${dif}`);

    return res.json({
      ok: true,
      id_evaluacion,
      valor_estandar: Number(std0.Valor || 0),
      question: {
        id_pregunta: Number(firstQ.id_pregunta),
        enunciado,
        opciones,
      },
      num_preg_max: effectiveMax,
      tiempo_limite_seg: (cfg && Number(cfg.tiempo_limite_seg) > 0) ? Number(cfg.tiempo_limite_seg) : null,
      estado_sesion: cfg?.estado ?? null,
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

    // 💾 guardar respuesta (conversión TIME si aplica)
    const saved = await insertRespuesta({
      id_evaluacion,
      id_pregunta: pid,
      id_opcion: oid,
      correcta,
      tiempo_respuesta: Number(tiempo_respuesta || 0), // en segundos desde el front
    });

    // === APLICAR MODOS (tiempo, número, cierre por docente)
    let cfg = null;
    try {
      cfg = await getSesionCfgByEvaluacion(id_evaluacion);
    } catch (e) {
      warn("getSesionCfgByEvaluacion:", e.message);
    }

    // 0) Cierre por docente
    const estado = (cfg?.estado || "").toString().trim().toLowerCase();
    if (["cerrada","cerrado","cancelada","cancelado","finalizada","finalizado","terminada","terminado"].includes(estado)) {
      await closeEvaluacionIfPossible(id_evaluacion);
      warn(`🛑 Sesión cerrada por docente | eval=${id_evaluacion}`);
      return res.json({ ok: true, correcta, finished: true, reason: "sesion_cerrada", question: null });
    }

    // 1) Límite de tiempo  -> solo si > 0 y hay iniciado_en
    if (cfg?.tiempo_limite_seg != null && Number(cfg.tiempo_limite_seg) > 0 && cfg?.iniciado_en) {
      const { rows: tnow } = await db.query(`SELECT NOW() as now`);
      const now = new Date(tnow[0].now);
      const started = new Date(cfg.iniciado_en);
      const elapsedSec = Math.floor((now.getTime() - started.getTime()) / 1000);
      if (elapsedSec >= Number(cfg.tiempo_limite_seg)) {
        await closeEvaluacionIfPossible(id_evaluacion);
        warn(`⏱️ Tiempo agotado | eval=${id_evaluacion} | elapsed=${elapsedSec}s`);
        return res.json({ ok: true, correcta, finished: true, reason: "timeout", question: null });
      }
    }

    // 2) Límite de número de preguntas -> usar solo si > 0
    let maxQ = null;
    const cfgMax = Number(cfg?.num_preg_max);
    if (Number.isFinite(cfgMax) && cfgMax > 0) {
      maxQ = cfgMax;
    } else {
      const bodyMax = Number(req.body?.num_preg_max);
      if (Number.isFinite(bodyMax) && bodyMax > 0) maxQ = bodyMax;
    }

    // cuántas ya se mostraron (sirve para el log de "Q actual")
    const { rows: cRowsPrev } = await db.query(
      `SELECT COUNT(1) AS c FROM "Detalle_evaluacion" WHERE "id_evaluacion"=$1`,
      [id_evaluacion]
    );
    const yaMostradas = Number(cRowsPrev[0].c) || 0;

    log(`📝 Respuesta | eval=${id_evaluacion} | Q#${yaMostradas} | preg=${pid} | opcion=${oid} | ` +
        `${correcta ? "CORRECTA ✔" : "INCORRECTA ✘"} | guardada=${saved ? "sí" : "no"}`);

    // Si hay límite por número, verificamos tras registrar respuesta
    if (maxQ != null && yaMostradas >= maxQ) {
      await closeEvaluacionIfPossible(id_evaluacion);
      log(`✅ Límite de preguntas alcanzado (${maxQ}) | eval=${id_evaluacion}`);
      return res.json({ ok:true, correcta, finished:true, reason:"max_preguntas", question:null });
    }

    // === Lógica adaptativa
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
          AND NOT (p."id_pregunta" = ANY(COALESCE($3::int[], ARRAY[]::int[])))
        ORDER BY ABS(e."Valor"::numeric - $2::numeric) ASC, p."id_pregunta" ASC
        LIMIT 1
        `,
        [Number(id_materia), targetValor, exclude.length ? exclude : null]
      );
      if (rows.length) nextQ = { id_pregunta: Number(rows[0].id_pregunta), enunciado: rows[0].enunciado };
    }

    if (!nextQ) {
      try { await db.query(`UPDATE "Evaluacion" SET "fecha_final"=NOW() WHERE "id_evaluacion"=$1`, [id_evaluacion]); } catch {}
      warn(`🟥 Sin más preguntas disponibles | eval=${id_evaluacion}`);
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

    log(`➡️ Siguiente | eval=${id_evaluacion} | Q#${nextOrder} -> preg=${nextQ.id_pregunta} | targetValor=${targetValor}`);

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
    log(`🧹 Sesión finalizada manualmente | eval=${id_evaluacion}`);
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
