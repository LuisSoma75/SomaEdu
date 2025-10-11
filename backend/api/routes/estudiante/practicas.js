// backend/api/routes/estudiante/practicas.js
import express from "express";
import db from "../../utils/db.js";

const router = express.Router();
const TAG = "[PRACTICAS]";

// ---- helpers de esquema (tolerantes) ----
async function tableCols(table) {
  const { rows } = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position`,
    [String(table)]
  );
  const cols = rows.map(r => r.column_name);
  console.log(`${TAG} cols "${table}":`, cols);
  return cols;
}
function pick(cols, ...cands) {
  const set = new Set(cols.map(c => c.toLowerCase()));
  for (const c of cands) {
    const hit = cols.find(x => x.toLowerCase() === String(c).toLowerCase());
    if (hit && set.has(String(c).toLowerCase())) return hit;
  }
  return null;
}
function logSqlPreview(label, sql) {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  console.log(`${TAG} SQL[${label}] = ${oneLine.slice(0, 240)}${oneLine.length > 240 ? " …" : ""}`);
}

// ---------------------------- GET /recomendadas ----------------------------
router.get("/recomendadas", async (req, res) => {
  const startedAt = Date.now();
  try {
    const carneRaw =
      req.query.carne ?? req.query.carne_estudiante ?? req.query.carnet ?? "";
    const carneStr = String(carneRaw).trim();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 12)));
    const strict = String(req.query.strict || "0") === "1";
    const wantDiag = String(req.query.diag || "0") === "1";

    console.log(`${TAG} >>> GET /recomendadas`, {
      query: req.query,
      carneStr,
      limit,
      strict,
      wantDiag
    });

    if (!carneStr) {
      console.log(`${TAG} !!! falta carne`);
      return res.status(400).json({ ok: false, msg: "Falta ?carne=..." });
    }

    // ===== 0) Diagnóstico general de la tabla (si existe) =====
    const recCols = await tableCols("recomendacion_estandar");
    let diag = {};
    if (recCols.length) {
      try {
        const colCarne = pick(recCols, "carne_estudiante","carne_est","carne") || "carne_estudiante";
        const { rows: countAll } = await db.query(`SELECT COUNT(*)::int AS total FROM "recomendacion_estandar"`);
        const { rows: distinctCarnes } = await db.query(
          `SELECT BTRIM("${colCarne}"::text) AS carne, COUNT(*)::int AS c
             FROM "recomendacion_estandar"
            GROUP BY 1
            ORDER BY c DESC, carne ASC
            LIMIT 20`
        );
        const { rows: sampleAny } = await db.query(
          `SELECT * FROM "recomendacion_estandar"
            ORDER BY COALESCE("creado_en",'1970-01-01'::timestamp) DESC
            LIMIT 10`
        );
        diag = {
          table_total: countAll?.[0]?.total ?? 0,
          distinct_carnes: distinctCarnes,
          sample_any: sampleAny
        };
        console.log(`${TAG} DIAG table_total=${diag.table_total}`);
        console.log(`${TAG} DIAG distinct carnes(top20)=`, distinctCarnes);
      } catch (e) {
        console.log(`${TAG} diag (global) error:`, e.message);
      }
    } else {
      console.log(`${TAG} la tabla recomendacion_estandar NO existe o está en otro schema`);
    }

    // ===== 1) Intento principal: leer de recomendacion_estandar =====
    if (recCols.length) {
      const colCarne   = pick(recCols, "carne_estudiante", "carne_est", "carne");
      const colStd     = pick(recCols, "id_estandar");
      const colPrio    = pick(recCols, "prioridad", "valor", "peso");
      const colVigente = pick(recCols, "vigente", "activo", "habilitado");
      const colFecha   = pick(recCols, "creado_en", "creado", "fecha", "fecha_creacion");
      const colIdRec   = pick(recCols, "id_rec", "id_recomendacion", "id");

      console.log(`${TAG} resolved rec columns:`, { colCarne, colStd, colPrio, colVigente, colFecha, colIdRec });

      if (colCarne && colStd) {
        const eCols = await tableCols("Estandar");
        const aCols = await tableCols("Area");
        const eName =
          (eCols.length && pick(eCols, "nombre", "Nombre", "nombre_estandar", "titulo", "descripcion")) ||
          "id_estandar";
        const aName =
          (aCols.length && pick(aCols, "nombre_area", "Nombre_area", "nombre", "Nombre", "titulo", "descripcion", "descripcion_area")) ||
          "id_area";

        console.log(`${TAG} resolved estandar/area columns:`, { eName, aName });

        const orderPieces = [];
        if (colPrio)  orderPieces.push(`re."${colPrio}" DESC`);
        if (colFecha) orderPieces.push(`re."${colFecha}" DESC`);
        if (!orderPieces.length) orderPieces.push(`e."id_estandar" DESC`);

        // Comparación robusta por texto + tolerar vigente NULL
        const whereVig = colVigente ? `AND COALESCE(re."${colVigente}", TRUE) = TRUE` : "";

        const sqlSaved = `
          SELECT
            ${colIdRec ? `re."${colIdRec}"` : `re."${colStd}"`} AS id,
            e."id_estandar"                                    AS id_estandar,
            e."${eName}"                                       AS titulo,
            a."${aName}"                                       AS area,
            ${colPrio ? `re."${colPrio}"` : "1"}               AS valor,
            a."id_materia"                                     AS id_materia
          FROM "recomendacion_estandar" re
          LEFT JOIN "Estandar" e ON e."id_estandar" = re."${colStd}"
          LEFT JOIN "Tema"     t ON t."id_tema"     = e."id_tema"
          LEFT JOIN "Area"     a ON a."id_area"     = t."id_area"
          WHERE BTRIM(re."${colCarne}"::text) = BTRIM($1::text)
            ${whereVig}
          ORDER BY ${orderPieces.join(", ")}
          LIMIT $2
        `;
        logSqlPreview("saved", sqlSaved);

        const { rows } = await db.query(sqlSaved, [carneStr, limit]);
        console.log(`${TAG} saved rows: ${rows.length}`);

        // Diagnóstico extra si 0 filas (por carné)
        if (!rows.length) {
          try {
            const { rows: r1 } = await db.query(
              `SELECT COUNT(1) AS c FROM "recomendacion_estandar" re WHERE BTRIM(re."${colCarne}"::text) = BTRIM($1::text)`,
              [carneStr]
            );
            const { rows: r2 } = colVigente
              ? await db.query(
                  `SELECT COUNT(1) AS c FROM "recomendacion_estandar" re WHERE BTRIM(re."${colCarne}"::text) = BTRIM($1::text) AND COALESCE(re."${colVigente}", TRUE) = TRUE`,
                  [carneStr]
                )
              : [{ c: 0 }];
            const { rows: sample } = await db.query(
              `SELECT re.* FROM "recomendacion_estandar" re WHERE BTRIM(re."${colCarne}"::text) = BTRIM($1::text) ORDER BY re."${colFecha || colIdRec || colStd}" DESC NULLS LAST LIMIT 5`,
              [carneStr]
            );
            diag.by_carne = {
              carne: carneStr,
              total: Number(r1?.[0]?.c || 0),
              con_vigente_true: Number(r2?.[0]?.c || 0),
              sample
            };
            console.log(`${TAG} diag (by_carne):`, diag.by_carne);
          } catch (e) {
            console.log(`${TAG} diag error:`, e.message);
          }
        }

        if (rows.length) {
          const payload = {
            ok: true,
            source: "saved",
            items: rows.map(r => ({
              id: r.id,
              id_estandar: Number(r.id_estandar),
              titulo: r.titulo ?? `Estándar ${r.id_estandar}`,
              area: r.area ?? "Área",
              valor: Number(r.valor ?? 0),
              id_materia: r.id_materia ?? null,
            })),
            ...(wantDiag ? { diag } : {})
          };
          console.log(`${TAG} >>> RESP [saved] count=${payload.items.length} in ${Date.now()-startedAt}ms`);
          return res.json(payload);
        }
      } else {
        console.log(`${TAG} no se detectaron columnas clave en recomendacion_estandar`);
      }
    }

    if (strict) {
      console.log(`${TAG} strict=1, no se aplica fallback`);
      return res.json({ ok: true, source: "saved-empty", items: [], ...(wantDiag ? { diag } : {}) });
    }

    // ===== 2) Fallback: generar desde respuestas incorrectas =====
    const evCols = await tableCols("Evaluacion");
    const rCols  = await tableCols("Respuesta");
    const eCols2 = await tableCols("Estandar");
    const aCols2 = await tableCols("Area");
    await tableCols("Pregunta"); // solo para log

    const okCol  = pick(rCols, "correcta", "ok", "es_correcta");
    const rEval  = pick(rCols, "id_evaluacion", "evaluacion_id");
    const rPreg  = pick(rCols, "id_pregunta", "pregunta_id");
    const evCar  = pick(evCols, "carne_estudiante", "carne_est", "carne");
    const eName2 =
      (eCols2.length && pick(eCols2, "nombre", "Nombre", "nombre_estandar", "titulo", "descripcion")) ||
      "id_estandar";
    const aName2 =
      (aCols2.length && pick(aCols2, "nombre_area", "Nombre_area", "nombre", "Nombre", "titulo", "descripcion", "descripcion_area")) ||
      "id_area";

    console.log(`${TAG} fallback columns:`, { okCol, rEval, rPreg, evCar, eName2, aName2 });

    if (!okCol || !rEval || !rPreg || !evCar) {
      console.log(`${TAG} faltan columnas para fallback → devolver vacío`);
      return res.json({ ok: true, source: "fallback-skip", items: [], ...(wantDiag ? { diag } : {}) });
    }

    const sqlFallback = `
      SELECT
        e."id_estandar"                        AS id_estandar,
        e."${eName2}"                          AS titulo,
        a."${aName2}"                          AS area,
        COUNT(*)::int                          AS valor,      -- prioridad = veces que falló
        a."id_materia"                         AS id_materia
      FROM "Respuesta" r
      JOIN "Evaluacion" ev ON ev."id_evaluacion" = r."${rEval}"
      JOIN "Pregunta"  p  ON p."id_pregunta"    = r."${rPreg}"
      JOIN "Estandar"  e  ON e."id_estandar"    = p."id_estandar"
      JOIN "Tema"      t  ON t."id_tema"        = e."id_tema"
      JOIN "Area"      a  ON a."id_area"        = t."id_area"
      WHERE BTRIM(ev."${evCar}"::text) = BTRIM($1::text) AND COALESCE(r."${okCol}", false) = false
      GROUP BY e."id_estandar", e."${eName2}", a."${aName2}", a."id_materia"
      ORDER BY valor DESC, e."id_estandar" DESC
      LIMIT $2
    `;
    logSqlPreview("fallback", sqlFallback);

    const { rows: rows2 } = await db.query(sqlFallback, [carneStr, limit]);
    console.log(`${TAG} fallback rows: ${rows2.length}`);

    const payload = {
      ok: true,
      source: "fallback",
      items: rows2.map(r => ({
        id: r.id_estandar,
        id_estandar: Number(r.id_estandar),
        titulo: r.titulo ?? `Estándar ${r.id_estandar}`,
        area: r.area ?? "Área",
        valor: Number(r.valor ?? 0),
        id_materia: r.id_materia ?? null,
      })),
      ...(wantDiag ? { diag } : {})
    };
    console.log(`${TAG} >>> RESP [fallback] count=${payload.items.length} in ${Date.now()-startedAt}ms`);
    return res.json(payload);
  } catch (err) {
    console.warn(TAG, "ERROR", err);
    res.status(500).json({ ok: false, msg: err.message || "No se pudieron cargar las recomendaciones." });
  }
});

// Por si llaman /api/estudiante/practicas (sin sufijo)
router.get("/", (_req, res) => res.json({ ok: true, items: [] }));

export default router;
