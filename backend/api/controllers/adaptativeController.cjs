// backend/api/controllers/adaptativeController.cjs
// Motor adaptativo + persistencias + recomendaciones (por id_usuario) con logs de diagnóstico.

const db = require("../utils/db.cjs");
const IA  = require("../services/ia.cjs");

const DBG  = true;
const log  = (...a) => DBG && console.log("[ADAPTIVE]", ...a);
const warn = (...a) => DBG && console.warn("[ADAPTIVE]", ...a);

/* ==================================
   Helper de SQL con logs
================================== */
async function q(sql, params = [], tag = "") {
  if (tag) log(`[SQL] ${tag} :: ${sql}  :: params=`, params);
  else     log(`[SQL] ${sql} | params:`, params);
  const t0 = Date.now();
  try {
    const res = await db.query(sql, params);
    log(`[SQL OK] ${tag || ""} (${Date.now()-t0}ms) rows=${res?.rows?.length ?? "null"}`);
    return res;
  } catch (e) {
    warn(`[SQL ERR] ${tag || ""} (${Date.now()-t0}ms): ${e.message}`);
    if (e.code) warn(" code:", e.code);
    if (e.position) warn(" position:", e.position);
    throw e;
  }
}

/* ==================================
   Introspección BD
================================== */
async function tableColumns(table) {
  const { rows } = await q(
    `SELECT column_name, is_nullable, column_default, data_type
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position`,
    [String(table)],
    "tableColumns"
  );
  return rows.map(r => ({
    name: r.column_name,
    required: (r.is_nullable === "NO") && (r.column_default == null),
    hasDefault: r.column_default != null,
    type: r.data_type,
  }));
}
async function hasColumns(table, names) {
  const cols = await tableColumns(table);
  const set = new Set(cols.map(c => c.name.toLowerCase()));
  return names.every(n => set.has(String(n).toLowerCase()));
}
function findRealCol(cols, lowerName) {
  const hit = cols.find(c => c.name.toLowerCase() === lowerName);
  return hit ? hit.name : null;
}
async function existsSesion(id_sesion) {
  if (!Number.isFinite(Number(id_sesion))) return false;
  const { rows } = await q(
    `SELECT 1 FROM "Sesion_evaluacion" WHERE "id_sesion"=$1`,
    [Number(id_sesion)],
    "existsSesion"
  );
  return !!rows.length;
}

/* ==================================
   Resolución de usuario / carné
================================== */

async function resolveUserId(req) {
  // 1) auth
  const uid =
    req?.user?.id_usuario ??
    req?.body?.id_usuario ??
    req?.query?.id_usuario ??
    req?.params?.id_usuario ??
    null;
  if (uid != null) return Number(uid);

  // 2) por carné en body/query
  const carne =
    req?.body?.carne_estudiante ?? req?.body?.carne ??
    req?.query?.carne ?? null;

  if (carne != null) {
    const { rows } = await q(
      `SELECT "id_usuario" FROM "Estudiantes"
        WHERE BTRIM("carne_estudiante"::text)=BTRIM($1::text)
        LIMIT 1`,
      [ String(carne) ],
      "resolveUserId.byCarne"
    );
    if (rows.length) return Number(rows[0].id_usuario);
  }
  return null;
}

async function resolveCarneFromUser(id_usuario) {
  if (!Number.isFinite(Number(id_usuario))) return null;
  try {
    const { rows } = await q(
      `SELECT "carne_estudiante" FROM "Estudiantes" WHERE "id_usuario"=$1 LIMIT 1`,
      [ Number(id_usuario) ],
      "resolveCarneFromUser"
    );
    if (rows.length && rows[0].carne_estudiante != null) {
      return String(rows[0].carne_estudiante).trim();
    }
  } catch (e) { warn("resolveCarneFromUser:", e.message); }
  return null;
}

async function resolveUserIdByEval(id_evaluacion, req) {
  const eCols = await tableColumns("Evaluacion");
  const set   = new Set(eCols.map(c => c.name.toLowerCase()));

  // 1) Si Evaluacion ya tiene id_usuario
  if (set.has("id_usuario")) {
    const { rows } = await q(
      `SELECT "id_usuario" FROM "Evaluacion" WHERE "id_evaluacion"=$1 LIMIT 1`,
      [Number(id_evaluacion)],
      "resolveUserIdByEval.ev.id_usuario"
    );
    const uid = rows?.[0]?.id_usuario;
    if (uid != null) return Number(uid);
  }

  // 2) Si no, intentar por carné guardado en Evaluacion
  let cond = [];
  if (set.has("carne_estudiante")) cond.push(`BTRIM(e."carne_estudiante"::text)=BTRIM(ev."carne_estudiante"::text)`);
  if (set.has("carne_est"))        cond.push(`BTRIM(e."carne_estudiante"::text)=BTRIM(ev."carne_est"::text)`);
  if (cond.length) {
    const sql = `
      SELECT e."id_usuario" AS uid
      FROM "Evaluacion" ev
      JOIN "Estudiantes" e ON (${cond.join(" OR ")})
      WHERE ev."id_evaluacion"=$1
      LIMIT 1
    `;
    const { rows } = await q(sql, [Number(id_evaluacion)], "resolveUserIdByEval.viaCarne");
    if (rows.length && rows[0].uid != null) return Number(rows[0].uid);
  }

  // 3) Fallback: del request
  const uid = await resolveUserId(req);
  if (uid != null) {
    log("[UID@EVAL] fallback request:", { id_evaluacion, id_usuario: uid });
    return uid;
  }
  warn("[UID@EVAL] NO RESUELTO para eval:", id_evaluacion);
  return null;
}

/* ==================================
   Config sesión/evaluación
================================== */
async function getSesionCfgByEvaluacion(id_evaluacion) {
  const { rows } = await q(`
    SELECT se."id_sesion",
           se."num_preg_max",
           se."tiempo_limite_seg",
           se."estado",
           se."iniciado_en"
      FROM "Evaluacion" ev
      JOIN "Sesion_evaluacion" se ON se."id_sesion" = ev."id_sesion"
     WHERE ev."id_evaluacion" = $1
  `, [Number(id_evaluacion)], "getSesionCfgByEvaluacion");
  return rows[0] || null;
}
async function markSesionStartedIfNeeded(id_sesion) {
  if (!Number.isFinite(Number(id_sesion))) return;
  const { rows } = await q(
    `SELECT "tiempo_limite_seg","iniciado_en"
       FROM "Sesion_evaluacion" WHERE "id_sesion"=$1`,
    [Number(id_sesion)],
    "markSesionStartedIfNeeded.get"
  );
  if (!rows.length) return;
  const { tiempo_limite_seg, iniciado_en } = rows[0];
  if (tiempo_limite_seg != null && Number(tiempo_limite_seg) > 0 && !iniciado_en) {
    await q(
      `UPDATE "Sesion_evaluacion" SET "iniciado_en" = NOW() WHERE "id_sesion"=$1`,
      [Number(id_sesion)],
      "markSesionStartedIfNeeded.upd"
    );
  }
}
async function closeEvaluacionIfPossible(id_evaluacion) {
  try {
    const cols = await tableColumns("Evaluacion");
    const hasFechaFinal = cols.some(c => c.name === "fecha_final");
    if (hasFechaFinal) {
      await q(
        `UPDATE "Evaluacion" SET "fecha_final" = NOW() WHERE "id_evaluacion"=$1`,
        [Number(id_evaluacion)],
        "closeEvaluacionIfPossible"
      );
    }
  } catch (e) { warn("closeEvaluacionIfPossible:", e.message); }
}

/* ==================================
   Dominio (ítems/estándares)
================================== */
async function getPreguntaValorColumn() {
  const cols = await tableColumns("Pregunta");
  const cands = ["valor", "Valor", "valor_pregunta", "puntaje", "peso"];
  for (const c of cands) {
    const hit = cols.find(x => x.name.toLowerCase() === c.toLowerCase());
    if (hit) return hit.name;
  }
  return null;
}
async function getValorFromPregunta(id_pregunta) {
  const pValCol = await getPreguntaValorColumn();
  if (pValCol) {
    const { rows } = await q(
      `SELECT "${pValCol}"::numeric AS v FROM "Pregunta" WHERE "id_pregunta"=$1`,
      [Number(id_pregunta)],
      "getValorFromPregunta.direct"
    );
    if (rows.length) return rows[0].v != null ? Number(rows[0].v) : null;
  }
  const { rows } = await q(`
    SELECT e."Valor"::numeric AS v
      FROM "Pregunta" p
      JOIN "Estandar" e ON e."id_estandar"=p."id_estandar"
     WHERE p."id_pregunta"=$1
  `, [Number(id_pregunta)], "getValorFromPregunta.viaEstandar");
  return rows.length ? Number(rows[0].v) : null;
}
async function getClosestStandard(id_materia, targetValorNum) {
  const { rows } = await q(`
    SELECT e."id_estandar", e."Valor"::numeric AS "Valor"
      FROM "Estandar" e
      JOIN "Tema"  t ON e."id_tema" = t."id_tema"
      JOIN "Area"  a ON t."id_area" = a."id_area"
     WHERE a."id_materia" = $1
     ORDER BY ABS(e."Valor"::numeric - $2::numeric) ASC
     LIMIT 1
  `, [Number(id_materia), Number(targetValorNum || 0)], "getClosestStandard");
  return rows[0] || null;
}
async function stepStandard(id_materia, currentValor, dir) {
  if (dir === "up") {
    const { rows } = await q(`
      SELECT e."id_estandar", e."Valor"::numeric AS "Valor"
        FROM "Estandar" e
        JOIN "Tema"  t ON e."id_tema" = t."id_tema"
        JOIN "Area"  a ON t."id_area" = a."id_area"
       WHERE a."id_materia" = $1 AND e."Valor"::numeric > $2::numeric
       ORDER BY e."Valor"::numeric ASC
       LIMIT 1
    `, [id_materia, currentValor], "stepStandard.up");
    return rows[0] || { id_estandar: null, Valor: currentValor };
  }
  if (dir === "down") {
    const { rows } = await q(`
      SELECT e."id_estandar", e."Valor"::numeric AS "Valor"
        FROM "Estandar" e
        JOIN "Tema"  t ON e."id_tema" = t."id_tema"
        JOIN "Area"  a ON t."id_area" = a."id_area"
       WHERE a."id_materia" = $1 AND e."Valor"::numeric < $2::numeric
       ORDER BY e."Valor"::numeric DESC
       LIMIT 1
    `, [id_materia, currentValor], "stepStandard.down");
    return rows[0] || { id_estandar: null, Valor: currentValor };
  }
  return { id_estandar: null, Valor: currentValor };
}
async function getAskedQuestionIds(id_evaluacion) {
  const { rows } = await q(
    `SELECT "id_pregunta" FROM "Detalle_evaluacion" WHERE "id_evaluacion"=$1 ORDER BY 1`,
    [id_evaluacion],
    "getAskedQuestionIds"
  );
  return rows.map(r => Number(r.id_pregunta));
}
async function getEnunciado(id_pregunta) {
  const { rows } = await q(
    `SELECT "enunciado" FROM "Pregunta" WHERE "id_pregunta"=$1`,
    [id_pregunta],
    "getEnunciado"
  );
  return rows.length ? String(rows[0].enunciado) : "Enunciado no disponible";
}

/**
 * Carga opciones de respuesta de forma robusta:
 * - Soporta "opciones_respuesta" (id_opcion/opcion/correcta) o variaciones (respuesta/texto/descripcion).
 * - Soporta una tabla "Respuesta" con id_respuesta/respuesta/correcta.
 * - Si no, escanea tablas con id_pregunta y arma dinámicamente la consulta.
 */
async function loadOptionsFromDB(id_pregunta) {
  const pid = Number(id_pregunta);

  // 1) opciones_respuesta si existe
  if (await hasColumns("opciones_respuesta", ["id_pregunta"])) {
    const cols = await tableColumns("opciones_respuesta");
    const set  = new Set(cols.map(c => c.name.toLowerCase()));

    const cId  = set.has("id_opcion") ? "id_opcion"
                : set.has("id_respuesta") ? "id_respuesta"
                : set.has("id") ? "id" : null;
    const cTxt = set.has("opcion") ? "opcion"
                : set.has("respuesta") ? "respuesta"
                : set.has("texto") ? "texto"
                : set.has("descripcion") ? "descripcion" : null;
    const cOk  = set.has("correcta") ? "correcta" : null;

    if (cId && cTxt) {
      const sql = `
        SELECT "${cId}" AS id, "${cTxt}" AS texto${cOk ? `, "${cOk}" AS ok` : ""}
          FROM "opciones_respuesta"
         WHERE "id_pregunta"=$1
         ORDER BY 1
      `;
      const { rows } = await q(sql, [pid], "loadOptionsFromDB.opciones_respuesta");
      if (rows.length) {
        return rows.map(r => ({
          id_opcion: Number(r.id),
          texto: String(r.texto),
          ...(r.ok != null ? { correcta: !!r.ok } : {})
        }));
      }
    }
  }

  // 2) Respuesta (otra tabla de opciones)
  if (await hasColumns("Respuesta", ["id_pregunta"])) {
    const cols = await tableColumns("Respuesta");
    const set  = new Set(cols.map(c => c.name.toLowerCase()));
    const cId  = set.has("id_respuesta") ? "id_respuesta" : set.has("id") ? "id" : null;
    const cTxt = set.has("respuesta") ? "respuesta"
                : set.has("texto") ? "texto"
                : set.has("descripcion") ? "descripcion" : null;
    const cOk  = set.has("correcta") ? "correcta" : null;

    if (cId && cTxt) {
      const sql = `
        SELECT "${cId}" AS id, "${cTxt}" AS texto${cOk ? `, "${cOk}" AS ok` : ""}
          FROM "Respuesta"
         WHERE "id_pregunta"=$1
         ORDER BY 1
      `;
      const { rows } = await q(sql, [pid], "loadOptionsFromDB.Respuesta");
      if (rows.length) {
        return rows.map(r => ({
          id_opcion: Number(r.id),
          texto: String(r.texto),
          ...(r.ok != null ? { correcta: !!r.ok } : {})
        }));
      }
    }
  }

  // 3) Fallback genérico: buscar cualquier tabla con id_pregunta
  const tabs = await q(
    `SELECT table_name
       FROM information_schema.columns
      WHERE table_schema='public' AND column_name ILIKE 'id_pregunta'
      GROUP BY table_name`,
    [],
    "loadOptionsFromDB.scan"
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
    const { rows } = await q(sql, [pid], `loadOptionsFromDB.fallback:${t}`);
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

/** Determina si una opción es correcta, con introspección de columnas. */
async function isOptionCorrect(id_opcion, id_pregunta) {
  // Intento dinámico sobre opciones_respuesta
  try {
    if (await hasColumns("opciones_respuesta", ["id_pregunta"])) {
      const cols = await tableColumns("opciones_respuesta");
      const set  = new Set(cols.map(c => c.name.toLowerCase()));
      const cId  = set.has("id_opcion") ? "id_opcion" : set.has("id_respuesta") ? "id_respuesta" : set.has("id") ? "id" : null;
      const cOk  = set.has("correcta") ? "correcta" : null;
      if (cId && cOk) {
        const { rows } = await q(
          `SELECT "${cOk}" AS ok FROM "opciones_respuesta" WHERE "${cId}"=$1 AND "id_pregunta"=$2`,
          [id_opcion, id_pregunta],
          "isOptionCorrect.opciones_respuesta"
        );
        if (rows.length) return !!rows[0].ok;
      }
    }
  } catch {}

  // Intento sobre Respuesta
  try {
    if (await hasColumns("Respuesta", ["id_pregunta"])) {
      const cols = await tableColumns("Respuesta");
      const set  = new Set(cols.map(c => c.name.toLowerCase()));
      const cId  = set.has("id_respuesta") ? "id_respuesta" : set.has("id") ? "id" : null;
      const cOk  = set.has("correcta") ? "correcta" : null;
      if (cId && cOk) {
        const { rows } = await q(
          `SELECT "${cOk}" AS ok FROM "Respuesta" WHERE "${cId}"=$1 AND "id_pregunta"=$2`,
          [id_opcion, id_pregunta],
          "isOptionCorrect.Respuesta"
        );
        if (rows.length) return !!rows[0].ok;
      }
    }
  } catch {}

  return false;
}

async function getTemporadaActivaId() {
  const { rows } = await q(
    `SELECT "id_temporada"
       FROM "Temporada"
      ORDER BY COALESCE("fecha_inicio",'1970-01-01') DESC
      LIMIT 1`,
    undefined,
    "getTemporadaActivaId"
  );
  return rows.length ? Number(rows[0].id_temporada) : null;
}

/* ==================================
   Balanceo por Áreas
================================== */
async function getAreasForMateria(id_materia) {
  const { rows } = await q(
    `SELECT a."id_area"
       FROM "Area" a
      WHERE a."id_materia"=$1
      ORDER BY a."id_area" ASC`,
    [Number(id_materia)],
    "getAreasForMateria"
  );
  return rows.map(r => Number(r.id_area));
}
async function getAreaIdFromPregunta(id_pregunta) {
  const { rows } = await q(`
    SELECT a."id_area"
      FROM "Pregunta" p
      JOIN "Estandar" e ON e."id_estandar" = p."id_estandar"
      JOIN "Tema"     t ON t."id_tema"     = e."id_tema"
      JOIN "Area"     a ON a."id_area"     = t."id_area"
     WHERE p."id_pregunta"=$1
     LIMIT 1
  `, [Number(id_pregunta)], "getAreaIdFromPregunta");
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
    const nameCol = pick("nombre_area","nombre","Nombre","descripcion","descripcion_area","titulo");
    if (!nameCol) return null;
    const { rows } = await q(
      `SELECT "${nameCol}" AS nombre FROM "Area" WHERE "id_area"=$1 LIMIT 1`,
      [Number(id_area)],
      "getAreaNameById"
    );
    return rows.length ? String(rows[0].nombre) : null;
  } catch { return null; }
}
async function getAreaCountsForEval(id_evaluacion) {
  const { rows } = await q(`
    SELECT a."id_area", COUNT(*)::int AS c
      FROM "Detalle_evaluacion" d
      JOIN "Pregunta"  p ON p."id_pregunta" = d."id_pregunta"
      JOIN "Estandar"  e ON e."id_estandar" = p."id_estandar"
      JOIN "Tema"      t ON t."id_tema"     = e."id_tema"
      JOIN "Area"      a ON a."id_area"     = t."id_area"
     WHERE d."id_evaluacion"=$1
     GROUP BY a."id_area"
  `, [Number(id_evaluacion)], "getAreaCountsForEval");
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
    const { rows } = await q(`
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
    `, [
      Number(id_materia),
      Number(targetValor || 0),
      (exclude.length ? exclude : [0]),
      (areasFilter && areasFilter.length ? areasFilter : null)
    ], "pickNextQuestionBalanced");
    return rows.length ? { id_pregunta: Number(rows[0].id_pregunta), enunciado: rows[0].enunciado, id_area: Number(rows[0].id_area) } : null;
  };
  let q1 = await tryPick(preferAreas);
  if (!q1) q1 = await tryPick(null);
  return q1;
}

/* ==================================
   Clase / Matrícula (por id_usuario)
================================== */

async function findClaseIdFor(id_grado, id_materia) {
  if (await hasColumns("Clase", ["id_clase"])) {
    const hasG = await hasColumns("Clase", ["id_grado"]);
    const hasM = await hasColumns("Clase", ["id_materia"]);
    if (hasG && hasM) {
      const { rows } = await q(
        `SELECT "id_clase"
           FROM "Clase"
          WHERE "id_grado"=$1 AND "id_materia"=$2
          ORDER BY "id_clase" ASC
          LIMIT 1`,
        [id_grado, id_materia],
        "findClaseIdFor.gm"
      );
      if (rows.length) return Number(rows[0].id_clase);
    }
    if (hasG) {
      const { rows } = await q(
        `SELECT "id_clase" FROM "Clase" WHERE "id_grado"=$1 ORDER BY "id_clase" ASC LIMIT 1`,
        [id_grado],
        "findClaseIdFor.g"
      );
      if (rows.length) return Number(rows[0].id_clase);
    }
    if (hasM) {
      const { rows } = await q(
        `SELECT "id_clase" FROM "Clase" WHERE "id_materia"=$1 ORDER BY "id_clase" ASC LIMIT 1`,
        [id_materia],
        "findClaseIdFor.m"
      );
      if (rows.length) return Number(rows[0].id_clase);
    }
  }
  // Fallback vía sesiones
  if (await hasColumns("Sesion_evaluacion", ["id_clase"])) {
    const { rows } = await q(`
      SELECT c."id_clase"
        FROM "Sesion_evaluacion" se
        JOIN "Clase" c ON c."id_clase" = se."id_clase"
       WHERE ($1::int IS NULL OR c."id_grado"=$1)
         AND ($2::int IS NULL OR c."id_materia"=$2)
       ORDER BY COALESCE(se."iniciado_en", se."creado_en") DESC NULLS LAST, se."id_sesion" DESC
       LIMIT 1
    `, [id_grado || null, id_materia || null], "findClaseIdFor.viaSes");
    if (rows.length) return Number(rows[0].id_clase);
  }
  return null;
}

/**
 * Garantiza/encuentra una matrícula usando el id_usuario (con fallbacks si la tabla Matricula
 * no tiene id_usuario y sólo maneja carne_estudiante).
 */
async function ensureMatriculaByUser(id_usuario, id_materia) {
  const mCols = await tableColumns("Matricula");
  const mSet  = new Set(mCols.map(c => c.name.toLowerCase()));
  const temporadaId = await getTemporadaActivaId();

  const eCols = await tableColumns("Estudiantes");
  const eSet  = new Set(eCols.map(c => c.name.toLowerCase()));

  // Datos del estudiante
  let id_grado_val = null;
  let carne_val    = null;
  try {
    const { rows } = await q(
      `SELECT "id_grado", "carne_estudiante"
         FROM "Estudiantes" WHERE "id_usuario"=$1 LIMIT 1`,
      [Number(id_usuario)],
      "ensureMatriculaByUser.findEstudiante"
    );
    if (!rows.length) throw new Error("Estudiante no encontrado para el usuario.");
    id_grado_val = rows[0].id_grado != null ? Number(rows[0].id_grado) : null;
    carne_val    = rows[0].carne_estudiante != null ? String(rows[0].carne_estudiante) : null;
  } catch (e) {
    warn("ensureMatriculaByUser.findEstudiante:", e.message);
    throw Object.assign(new Error("No se encontró el estudiante."), { status: 400 });
  }

  // 1) Buscar matrícula existente por id_usuario (si existe la columna)
  if (mSet.has("id_usuario")) {
    if (temporadaId != null && mSet.has("id_temporada")) {
      const r = await q(
        `SELECT "id_matricula" FROM "Matricula"
          WHERE "id_usuario"=$1 AND "id_temporada"=$2
          ORDER BY "id_matricula" DESC LIMIT 1`,
        [Number(id_usuario), temporadaId],
        "ensureMatriculaByUser.byUser+temp"
      );
      if (r.rows.length) return Number(r.rows[0].id_matricula);
    }
    const r2 = await q(
      `SELECT "id_matricula" FROM "Matricula"
        WHERE "id_usuario"=$1
        ORDER BY "id_matricula" DESC LIMIT 1`,
      [Number(id_usuario)],
      "ensureMatriculaByUser.byUser"
    );
    if (r2.rows.length) return Number(r2.rows[0].id_matricula);
  }

  // 2) Buscar por carné si Matricula no tiene id_usuario pero sí carne_estudiante
  if (!mSet.has("id_usuario") && mSet.has("carne_estudiante") && carne_val != null) {
    if (temporadaId != null && mSet.has("id_temporada")) {
      const r = await q(
        `SELECT "id_matricula" FROM "Matricula"
          WHERE "carne_estudiante"=$1 AND "id_temporada"=$2
          ORDER BY "id_matricula" DESC LIMIT 1`,
        [carne_val, temporadaId],
        "ensureMatriculaByUser.byCarne+temp"
      );
      if (r.rows.length) return Number(r.rows[0].id_matricula);
    }
    const r2 = await q(
      `SELECT "id_matricula" FROM "Matricula"
        WHERE "carne_estudiante"=$1
        ORDER BY "id_matricula" DESC LIMIT 1`,
      [carne_val],
      "ensureMatriculaByUser.byCarne"
    );
    if (r2.rows.length) return Number(r2.rows[0].id_matricula);
  }

  // 3) Crear matrícula con lo disponible
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
  const canUse = (n) => mSet.has(String(n).toLowerCase());

  if (canUse("id_usuario"))        values.id_usuario = Number(id_usuario);
  if (canUse("id_grado") && id_grado_val != null) values.id_grado = id_grado_val;
  if (canUse("id_materia")) values.id_materia = Number(id_materia);
  if (canUse("id_temporada") && temporadaId != null) values.id_temporada = temporadaId;
  if (canUse("carne_estudiante") && carne_val != null) values.carne_estudiante = carne_val;
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
  const { rows: ins } = await q(sql, cols.map(c => values[c]), "ensureMatriculaByUser.insert");
  const newId = Number(ins[0].id_matricula);
  log("Matricula creada:", { id_matricula: newId, cols });
  return newId;
}

/* ==================================
   Crear evaluación (flex con id_usuario)
================================== */

async function createEvaluacionFlex({ id_usuario, id_materia, id_sesion, carne_est_override }) {
  const cols = await tableColumns("Evaluacion");
  const set  = new Set(cols.map(c => c.name.toLowerCase()));
  const requiredCols = cols.filter(c => c.required).map(c => c.name.toLowerCase());

  const values = {};
  const addIf = (name, val) => { if (set.has(name)) values[name] = val; };

  addIf("id_materia", Number(id_materia));
  addIf("fecha_inicio", new Date());
  if (set.has("id_usuario") && id_usuario != null) addIf("id_usuario", Number(id_usuario));

  // Si Evaluacion tiene carné obligatorio, poblarlo desde el usuario
  if (set.has("carne_est") || set.has("carne_estudiante")) {
    const mustCarne = requiredCols.includes("carne_est") || requiredCols.includes("carne_estudiante");
    let carne = carne_est_override ?? (await resolveCarneFromUser(id_usuario));
    if (mustCarne && (carne == null || String(carne).trim() === "")) {
      throw Object.assign(new Error("No se pudo crear la evaluación: falta carné y es obligatorio."), { status: 400 });
    }
    if (set.has("carne_est") && carne != null) values.carne_est = String(carne);
    if (set.has("carne_estudiante") && carne != null) values.carne_estudiante = String(carne);
  }

  if (set.has("id_temporada")) {
    const tmpId = await getTemporadaActivaId();
    if (tmpId == null && requiredCols.includes("id_temporada")) {
      throw Object.assign(new Error("No hay temporada activa."), { status: 400 });
    }
    if (tmpId != null) values.id_temporada = tmpId;
  }

  if (set.has("id_matricula")) {
    try {
      values.id_matricula = await ensureMatriculaByUser(Number(id_usuario), Number(id_materia));
    } catch (e) {
      if (requiredCols.includes("id_matricula")) {
        warn("[EVAL] crear evaluación: id_matricula requerido pero falló ensureMatriculaByUser:", e.message);
        throw e;
      } else {
        warn("[EVAL] ensureMatriculaByUser falló, continúo SIN id_matricula:", e.message);
      }
    }
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
  log("[EVAL] INSERT params:", values);
  const { rows } = await q(sql, cNames.map(c => values[c]), "createEvaluacionFlex.insert");
  const idEval = Number(rows[0].id_evaluacion);
  log("[EVAL] creada id =", idEval);
  return idEval;
}

/* ==================================
   Resultados por área (RIT)
================================== */

async function getAreaResults(id_evaluacion) {
  const hasResp = await hasColumns("Respuesta", ["id_evaluacion","id_pregunta"]);
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
  const { rows } = await q(sql, [Number(id_evaluacion)], "getAreaResults");

  const toLevel = (rit, maxv) => {
    const qf = maxv > 0 ? (rit / maxv) : 0;
    return qf >= 0.85 ? "avanzado"
         : qf >= 0.65 ? "satisfactorio"
         : qf >= 0.40 ? "en_proceso"
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
      rit: ritRounded,
      nivel: toLevel(rit, maxv),
    };
  });
}

/* ==================================
   Resumen/snapshots
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

async function ensureResumenTableExists() {
  try {
    await q(`
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
    `, [], "ensureResumenTableExists.create");
    await q(`ALTER TABLE "Resumen_evaluacion" ADD COLUMN IF NOT EXISTS "pct_area_prom" NUMERIC(5,1)`, [], "ensureResumenTableExists.alter1");
    await q(`ALTER TABLE "Resumen_evaluacion" ADD COLUMN IF NOT EXISTS "rit_area_prom" NUMERIC(6,1)`, [], "ensureResumenTableExists.alter2");
  } catch (e) { warn("ensureResumenTableExists:", e.message); }
}
async function saveSummaryForEvaluacion(id_evaluacion, summary) {
  try {
    // Guardar summary en tabla Evaluacion si hay columnas
    try {
      const eCols = await tableColumns("Evaluacion");
      const set = new Set(eCols.map(c => c.name.toLowerCase()));
      const updPairs = [];
      const params = [];
      let i = 1;
      const addIf = (cands, val) => {
        for (const c of cands) if (set.has(c)) {
          const real = findRealCol(eCols, c);
          if (real) {
            updPairs.push(`"${real}" = $${i++}`);
            params.push(val);
            return true;
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
          await q(
            `UPDATE "Evaluacion" SET "${target}" = $1::jsonb WHERE "id_evaluacion"=$2`,
            [JSON.stringify(summary), Number(id_evaluacion)],
            "saveSummaryForEvaluacion.jsonb"
          );
        } catch {
          try {
            await q(
              `UPDATE "Evaluacion" SET "${target}" = $1 WHERE "id_evaluacion"=$2`,
              [JSON.stringify(summary), Number(id_evaluacion)],
              "saveSummaryForEvaluacion.json"
            );
          } catch (e2) { warn("Guardar resumen JSON en Evaluacion:", e2.message); }
        }
      }
      if (updPairs.length) {
        params.push(Number(id_evaluacion));
        const sql = `UPDATE "Evaluacion" SET ${updPairs.join(", ")} WHERE "id_evaluacion"=$${i}`;
        await q(sql, params, "saveSummaryForEvaluacion.fields");
      }
    } catch (e) { warn("saveSummary Evaluacion:", e.message); }

    // Upsert a tabla resumen
    await ensureResumenTableExists();
    await q(
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
      ],
      "Resumen_evaluacion upsert"
    );
  } catch (e) { warn("saveSummaryForEvaluacion (general):", e.message); }
}

async function ensureSnapshotAreaTableExists() {
  try {
    await q(`
      CREATE TABLE IF NOT EXISTS "snapshot_promedio_area" (
        "id_snapshot"    BIGSERIAL PRIMARY KEY,
        "id_evaluacion"  BIGINT NOT NULL,
        "id_area"        BIGINT NOT NULL,
        "promedio_area"  NUMERIC(5,2) NOT NULL,
        CONSTRAINT "evaluacion_area_uniq" UNIQUE ("id_evaluacion","id_area"),
        CONSTRAINT "snapshot_area" FOREIGN KEY ("id_area") REFERENCES "Area"("id_area")
      );
    `, [], "ensureSnapshotAreaTableExists");
  } catch (e) { warn("ensureSnapshotAreaTableExists:", e.message); }
}
async function saveAreaSnapshots(id_evaluacion, areas = []) {
  try {
    await ensureSnapshotAreaTableExists();
    for (const a of areas) {
      const total = Number(a.total) || 0;
      if (total <= 0) continue;
      const prom = Number((Number(a.rit) || 0).toFixed(2));
      await q(
        `
        INSERT INTO "snapshot_promedio_area"
          ("id_evaluacion","id_area","promedio_area")
        VALUES ($1,$2,$3)
        ON CONFLICT ("id_evaluacion","id_area")
        DO UPDATE SET "promedio_area"=EXCLUDED."promedio_area"
        `,
        [ Number(id_evaluacion), Number(a.id_area), prom ],
        "saveAreaSnapshots.upsert"
      );
    }
  } catch (e) { warn("saveAreaSnapshots:", e.message); }
}

/* ==================================
   Recomendaciones (por id_usuario)
================================== */

async function ensureRecoInfra() {
  try {
    // Columna id_usuario si hiciera falta
    const rCols = await tableColumns("recomendacion_estandar");
    const rSet  = new Set(rCols.map(c => c.name.toLowerCase()));
    if (!rSet.has("id_usuario")) {
      await q(`ALTER TABLE "recomendacion_estandar" ADD COLUMN "id_usuario" INTEGER`, [], "ensureRecoInfra.add_id_usuario");
      await q(`
        ALTER TABLE "recomendacion_estandar"
        ADD CONSTRAINT "reco_usuario_fk"
        FOREIGN KEY ("id_usuario") REFERENCES "Usuarios"("id_usuario") ON DELETE CASCADE
      `, [], "ensureRecoInfra.fk");
    }
    // Índice único para upsert
    await q(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname='public' AND indexname='ux_reco_user_std_vig'
        ) THEN
          CREATE UNIQUE INDEX ux_reco_user_std_vig
            ON "recomendacion_estandar" ("id_usuario","id_estandar","vigente");
        END IF;
      END
      $$;
    `, [], "ensureRecoInfra.uniq");
  } catch (e) { warn("ensureRecoInfra:", e.message); }
}

async function getCarneByUser(id_usuario) {
  try {
    const { rows } = await q(
      `SELECT "carne_estudiante" AS carne FROM "Estudiantes" WHERE "id_usuario"=$1 LIMIT 1`,
      [Number(id_usuario)],
      "getCarneByUser"
    );
    if (rows.length) return rows[0].carne != null ? String(rows[0].carne) : null;
  } catch {}
  return null;
}

/**
 * Upsert recomendación por id_usuario. Si la tabla todavía exige carne_estudiante NOT NULL,
 * intentamos poblarla con el carné del usuario para no romper la inserción.
 * (FIX 42P18: placeholders consecutivos, sin $7 huérfano)
 */
async function upsertRecoByUser(id_usuario, id_estandar, { prioridad = 1, fuente = "adaptative", motivo = "respuesta_incorrecta" } = {}) {
  await ensureRecoInfra();

  const uid = Number(id_usuario);
  const std = Number(id_estandar);
  if (!Number.isFinite(uid) || !Number.isFinite(std)) {
    warn("[RECO UPSERT] params inválidos:", { id_usuario: uid, id_estandar: std });
    return;
  }

  // ¿La tabla obliga carne_estudiante?
  const rCols = await tableColumns("recomendacion_estandar");
  const rSet  = new Set(rCols.map(c => c.name.toLowerCase()));
  const carneCol = rSet.has("carne_estudiante") ? rCols.find(c => c.name.toLowerCase()==="carne_estudiante") : null;
  let carneVal = null;
  if (carneCol && carneCol.required) {
    carneVal = await getCarneByUser(uid); // para satisfacer NOT NULL en esquemas antiguos
    if (carneVal == null) warn("[RECO UPSERT] carne_estudiante es NOT NULL en la tabla pero no se pudo resolver para el usuario", uid);
  }

  // NOTA: NO incluimos un placeholder para creado_en (usamos NOW() en SQL)
  //       y por lo tanto NO dejamos un "null" en params. Placeholders consecutivos siempre.
  let fields, params, sql;

  if (carneCol && carneCol.required) {
    // Con carne_estudiante requerido
    fields = ['"id_usuario"','"carne_estudiante"','"id_estandar"','"motivo"','"fuente"','"prioridad"','"creado_en"','"vigente"'];
    params = [uid, carneVal, std, String(motivo), String(fuente), Number(prioridad), true];
    const ph = params.map((_,i)=>`$${i+1}`);
    sql = `
      INSERT INTO "recomendacion_estandar"
        (${fields.join(",")})
      VALUES (${ph[0]},${ph[1]},${ph[2]},${ph[3]},${ph[4]},${ph[5]},NOW(),${ph[6]})
      ON CONFLICT ("id_usuario","id_estandar","vigente")
      DO UPDATE SET
        "prioridad" = "recomendacion_estandar"."prioridad" + EXCLUDED."prioridad",
        "fuente"    = EXCLUDED."fuente",
        "motivo"    = EXCLUDED."motivo",
        "vigente"   = TRUE
      RETURNING "id_rec","id_usuario","id_estandar","prioridad","vigente","creado_en"
    `;
  } else {
    // Sin carne_estudiante requerido
    fields = ['"id_usuario"','"id_estandar"','"motivo"','"fuente"','"prioridad"','"creado_en"','"vigente"'];
    params = [uid, std, String(motivo), String(fuente), Number(prioridad), true];
    const ph = params.map((_,i)=>`$${i+1}`);
    sql = `
      INSERT INTO "recomendacion_estandar"
        (${fields.join(",")})
      VALUES (${ph[0]},${ph[1]},${ph[2]},${ph[3]},${ph[4]},NOW(),${ph[5]})
      ON CONFLICT ("id_usuario","id_estandar","vigente")
      DO UPDATE SET
        "prioridad" = "recomendacion_estandar"."prioridad" + EXCLUDED."prioridad",
        "fuente"    = EXCLUDED."fuente",
        "motivo"    = EXCLUDED."motivo",
        "vigente"   = TRUE
      RETURNING "id_rec","id_usuario","id_estandar","prioridad","vigente","creado_en"
    `;
  }

  try {
    const { rows } = await q(sql, params, "upsertRecoByUser");
    log("[RECO UPSERT] ok row =", rows?.[0]);
  } catch (e) {
    warn("[RECO UPSERT] error:", e.message);
  }
}

/** Backfill al finalizar: junta todas las incorrectas y suma prioridad por estándar. */
async function backfillRecoFromAnswers(id_evaluacion) {
  try {
    const eCols = await tableColumns("Evaluacion");
    const eSet  = new Set(eCols.map(c => c.name.toLowerCase()));
    const hasIdUser = eSet.has("id_usuario");

    // join Estudiantes sólo si necesitamos mapear carné -> id_usuario
    const joinCond = [];
    if (!hasIdUser) {
      if (eSet.has("carne_estudiante")) joinCond.push(`BTRIM(e."carne_estudiante"::text) = BTRIM(ev."carne_estudiante"::text)`);
      if (eSet.has("carne_est"))        cond.push(`BTRIM(e."carne_estudiante"::text) = BTRIM(ev."carne_est"::text)`);
    }

    const sql = `
      SELECT
        ${hasIdUser ? `ev."id_usuario"` : `COALESCE(ev."id_usuario", e."id_usuario")`}::int AS uid,
        p."id_estandar"::int AS id_std,
        COUNT(*)::int AS prio
      FROM "Respuesta" r
      JOIN "Pregunta" p ON p."id_pregunta" = r."id_pregunta"
      JOIN "Evaluacion" ev ON ev."id_evaluacion" = r."id_evaluacion"
      ${!hasIdUser && joinCond.length ? `LEFT JOIN "Estudiantes" e ON (${joinCond.join(" OR ")})` : ""}
      WHERE r."correcta" = FALSE
        AND r."id_evaluacion" = $1
        AND p."id_estandar" IS NOT NULL
      GROUP BY ${hasIdUser ? `ev."id_usuario"` : `COALESCE(ev."id_usuario", e."id_usuario")`}, p."id_estandar"
    `;
    const { rows } = await q(sql, [Number(id_evaluacion)], "backfillRecoFromAnswers.load");
    for (const r of rows) {
      if (r.uid != null) {
        await upsertRecoByUser(Number(r.uid), Number(r.id_std), {
          prioridad: Number(r.prio) || 1,
          fuente: "adaptative/backfill",
          motivo: "respuesta_incorrecta"
        });
      }
    }
  } catch (e) {
    warn("backfillRecoFromAnswers:", e.message);
  }
}

/* ==================================
   Endpoints
================================== */

async function startSession(req, res) {
  try {
    log("POST /session/start body =", req.body);

    // Resolver usuario (id_usuario) y, si hace falta, el carné para Evaluacion vieja
    const fromBodyCarne = req?.body?.carne_estudiante ?? req?.query?.carne ?? null;
    let id_usuario = await resolveUserId(req);
    if (id_usuario == null && fromBodyCarne != null) {
      const { rows } = await q(
        `SELECT "id_usuario" FROM "Estudiantes" WHERE BTRIM("carne_estudiante"::text)=BTRIM($1::text) LIMIT 1`,
        [ String(fromBodyCarne) ],
        "start.resolveUserId.byCarne"
      );
      if (rows.length) id_usuario = Number(rows[0].id_usuario);
    }
    if (id_usuario == null) {
      return res.status(400).json({ ok:false, msg:"No se pudo resolver el usuario (id_usuario)." });
    }

    // Validar/normalizar sesión
    const id_materia = Number(req.body?.id_materia);
    let id_sesion =
      req.body?.id_sesion ?? req.body?.sessionId ??
      req.query?.id_sesion ?? req.query?.sessionId ??
      req.params?.id_sesion ?? req.params?.id;
    if (!(await existsSesion(id_sesion))) id_sesion = null;

    // promedio (si existe en Estudiantes)
    let promedio = 0;
    try {
      const s1 = await q(
        `SELECT "promedio" FROM "Estudiantes" WHERE "id_usuario"=$1 LIMIT 1`,
        [Number(id_usuario)],
        "start.promedio"
      );
      if (s1.rows.length) promedio = Number(s1.rows[0].promedio) || 0;
    } catch (e) { warn("[START] promedio:", e.message); }

    const std0 = (await getClosestStandard(Number(id_materia), promedio)) || { id_estandar: null, Valor: 0 };

    // Primera pregunta
    const firstQ = await pickNextQuestionBalanced({
      id_materia: Number(id_materia),
      targetValor: Number(std0.Valor || 0),
      exclude: [],
      preferAreas: await getAreasForMateria(Number(id_materia)),
    });
    if (!firstQ) {
      return res.status(400).json({ ok:false, msg:"No se encontró una pregunta inicial." });
    }

    // Crear evaluación (inserta id_usuario; si Evaluacion exige carné, lo rellena automáticamente)
    const id_evaluacion = await createEvaluacionFlex({
      id_usuario: Number(id_usuario),
      id_materia: Number(id_materia),
      id_sesion: id_sesion,
      carne_est_override: fromBodyCarne ?? null,
    });

    // reloj si aplica
    try { if (Number.isFinite(Number(id_sesion))) await markSesionStartedIfNeeded(id_sesion); } catch (e) { warn("markSesionStartedIfNeeded:", e.message); }

    // registrar primera pregunta
    const { rows: cRows } = await q(
      `SELECT COUNT(1) AS c FROM "Detalle_evaluacion" WHERE "id_evaluacion"=$1`,
      [id_evaluacion],
      "start.detalle.count"
    );
    const nextOrder = Number(cRows[0].c) + 1;
    const dif = Number(std0.Valor || 0);

    await q(
      `
      INSERT INTO "Detalle_evaluacion"
        ("id_evaluacion","id_pregunta","orden","dificultad_mostrada","presentado_en","theta_previo","theta_posterior")
      VALUES ($1,$2,$3,$4, NOW(), $5, $6)
      `,
      [id_evaluacion, Number(firstQ.id_pregunta), nextOrder, dif, 0, 0],
      "start.detalle.insert"
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
        valor: Number(valorItem ?? 0),
      },
      num_preg_max: Number(req.body?.num_preg_max ?? 10),
    });
  } catch (err) {
    warn("start error:", err);
    const msg = err?.data?.msg || err?.msg || err.message || "No se pudo iniciar la sesión.";
    return res.status(err.status || 500).json({ ok:false, msg });
  }
}

/**
 * POST /api/adaptative/session/:id/answer
 * Body: { id_pregunta, id_opcion, id_materia, valor_estandar_actual, tiempo_respuesta }
 */
async function submitAnswer(req, res) {
  try {
    const id_evaluacion = Number(
      req.body?.evaluacionId ?? req.body?.id_evaluacion ?? req.params?.id
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
    log("[ANSWER] isCorrect?", { id_evaluacion, pid, oid, correcta });

    // guardar respuesta si existe tabla base
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

          await q(
            `
            INSERT INTO "Respuesta"
              ("id_evaluacion","id_pregunta","id_opcion","correcta","tiempo_respuesta")
            VALUES ($1,$2,$3,$4,$5::time)
            `,
            [ id_evaluacion, pid, oid, correcta, timeStr ],
            "[ANSWER] insert Respuesta (tiempo+correcta)"
          );
        } else if (hasCorrecta) {
          await q(
            `
            INSERT INTO "Respuesta"
              ("id_evaluacion","id_pregunta","id_opcion","correcta")
            VALUES ($1,$2,$3,$4)
            `,
            [ id_evaluacion, pid, oid, correcta ],
            "[ANSWER] insert Respuesta (correcta)"
          );
        } else {
          await q(
            `
            INSERT INTO "Respuesta"
              ("id_evaluacion","id_pregunta","id_opcion")
            VALUES ($1,$2,$3)
            `,
            [ id_evaluacion, pid, oid ],
            "[ANSWER] insert Respuesta"
          );
        }
      }
    } catch (e) { warn("INSERT Respuesta falló:", e.message); }

    // ===== Recomendación si fue incorrecta -> por id_usuario =====
    if (correcta === false) {
      try {
        const id_usuario = await resolveUserIdByEval(id_evaluacion, req);
        const { rows: pr } = await q(
          `SELECT "id_estandar" FROM "Pregunta" WHERE "id_pregunta"=$1 LIMIT 1`,
          [ pid ],
          "answer.stdByPregunta"
        );
        const id_estandar = pr.length ? Number(pr[0].id_estandar) : null;

        log("[RECO] id_usuario:", id_usuario, " id_estandar:", id_estandar, " eval:", id_evaluacion);

        if (id_usuario != null && id_estandar != null) {
          await upsertRecoByUser(id_usuario, id_estandar, {
            prioridad: 1,
            fuente: "adaptative",
            motivo: "respuesta_incorrecta"
          });
        } else {
          warn("[RECO] skip: id_usuario/id_estandar nulos", { id_usuario, id_estandar });
        }
      } catch (e) { warn("Reco on wrong answer error:", e.message); }
    }

    // ===== límites / cierres =====
    let cfg = null;
    try { cfg = await getSesionCfgByEvaluacion(id_evaluacion); } catch (e) { warn("getSesionCfgByEvaluacion:", e.message); }

    // cierre por docente
    if (cfg?.estado && ["cerrada", "cancelada"].includes(String(cfg.estado))) {
      await closeEvaluacionIfPossible(id_evaluacion);
      const areas = await getAreaResults(id_evaluacion);
      const summary = summarizeAreas(areas);
      await saveSummaryForEvaluacion(id_evaluacion, summary);
      await saveAreaSnapshots(id_evaluacion, areas);
      await backfillRecoFromAnswers(id_evaluacion);
      return res.json({ ok: true, correcta, finished: true, reason: "sesion_cerrada", areas, summary, question: null });
    }

    // límite por tiempo
    if (cfg?.tiempo_limite_seg != null && Number(cfg.tiempo_limite_seg) > 0 && cfg?.iniciado_en) {
      const { rows: tnow } = await q(`SELECT NOW() as now`, [], "answer.now");
      const now = new Date(tnow[0].now);
      const started = new Date(cfg.iniciado_en);
      const elapsedSec = Math.floor((now.getTime() - started.getTime()) / 1000);
      if (elapsedSec >= Number(cfg.tiempo_limite_seg)) {
        await closeEvaluacionIfPossible(id_evaluacion);
        const areas = await getAreaResults(id_evaluacion);
        const summary = summarizeAreas(areas);
        await saveSummaryForEvaluacion(id_evaluacion, summary);
        await saveAreaSnapshots(id_evaluacion, areas);
        await backfillRecoFromAnswers(id_evaluacion);
        return res.json({ ok: true, correcta, finished: true, reason: "timeout", areas, summary, question: null });
      }
    }

    // límite por # preguntas
    let maxQ = null;
    if (cfg?.num_preg_max != null) maxQ = Number(cfg.num_preg_max);
    if (maxQ != null) {
      const { rows: cRows } = await q(
        `SELECT COUNT(1) AS c FROM "Detalle_evaluacion" WHERE "id_evaluacion"=$1`,
        [id_evaluacion],
        "answer.detalle.count"
      );
      const yaMostradas = Number(cRows[0].c) || 0;
      if (yaMostradas >= maxQ) {
        await closeEvaluacionIfPossible(id_evaluacion);
        const areas = await getAreaResults(id_evaluacion);
        const summary = summarizeAreas(areas);
        await saveSummaryForEvaluacion(id_evaluacion, summary);
        await saveAreaSnapshots(id_evaluacion, areas);
        await backfillRecoFromAnswers(id_evaluacion);
        return res.json({ ok:true, correcta, finished:true, reason:"max_preguntas", areas, summary, question:null });
      }
    }

    // ===== siguiente pregunta =====
    let twoRight=false, twoWrong=false;
    try {
      const { rows } = await q(
        `SELECT "correcta" FROM "Respuesta" WHERE "id_evaluacion"=$1 ORDER BY "id_respuesta" DESC LIMIT 2`,
        [id_evaluacion],
        "answer.last2"
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
    } catch (e) { warn("IA.rank falló; fallback SQL:", e.message); }

    // balanceo por áreas si IA devolvió algo
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
      await backfillRecoFromAnswers(id_evaluacion);
      return res.json({ ok:true, correcta, finished:true, areas, summary, question:null });
    }

    // registrar siguiente pregunta
    const { rows: cRows2 } = await q(
      `SELECT COUNT(1) AS c FROM "Detalle_evaluacion" WHERE "id_evaluacion"=$1`,
      [id_evaluacion],
      "answer.detalle.count2"
    );
    const nextOrder = Number(cRows2[0].c) + 1;

    await q(
      `
      INSERT INTO "Detalle_evaluacion"
        ("id_evaluacion","id_pregunta","orden","dificultad_mostrada","presentado_en","theta_previo","theta_posterior")
      VALUES ($1,$2,$3,$4, NOW(), $5, $6)
      `,
      [id_evaluacion, Number(nextQ.id_pregunta), nextOrder, targetValor, 0, 0],
      "answer.detalle.insert"
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
        valor: Number(valorNext ?? 0),
      },
      valor_estandar: targetValor,
    });
  } catch (err) {
    warn("answer error:", err);
    const msg = err?.data?.msg || err?.msg || err.message || "No se pudo obtener la siguiente pregunta.";
    return res.status(err.status || 500).json({ ok:false, msg });
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
    await backfillRecoFromAnswers(id_evaluacion);

    return res.json({ ok:true, ended:true, areas, summary });
  } catch (err) {
    warn("end error:", err);
    return res.status(500).json({ ok:false, msg: err.message || "Error al finalizar sesión" });
  }
}

async function areasByEvaluacion(req, res) {
  try {
    const id_evaluacion = Number(
      req.params?.id ?? req.query?.evaluacionId ?? req.query?.id_evaluacion
    );
    if (!id_evaluacion) {
      return res.status(400).json({ ok:false, msg:"id_evaluacion requerido" });
    }
    const areas = await getAreaResults(id_evaluacion);
    const summary = summarizeAreas(areas);
    return res.json({ ok:true, areas, summary });
  } catch (err) {
    warn("areasByEvaluacion error:", err);
    return res.status(500).json({ ok:false, msg: err.message || "Error al obtener áreas" });
  }
}

module.exports = {
  startSession,
  submitAnswer,
  endSession,
  areasByEvaluacion,
};
