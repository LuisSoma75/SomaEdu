const express = require("express");
const db = require("../../utils/db.cjs");
const router = express.Router();

// Helpers chicos para tolerar esquemas con nombres distintos
async function tableCols(table) {
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [String(table)]
  );
  return rows.map(r => r.column_name);
}
function pick(cols, ...cands) {
  const set = new Set(cols.map(c => c.toLowerCase()));
  for (const c of cands) if (set.has(c.toLowerCase())) {
    return cols.find(x => x.toLowerCase() === c.toLowerCase());
  }
  return null;
}

router.get("/recomendadas", async (req, res) => {
  try {
    const carne = Number(req.query.carne || req.query.carne_estudiante || req.query.carnet || 0);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 12)));
    if (!carne) return res.status(400).json({ ok:false, msg:"Falta ?carne=..." });

    // Columnas reales (tolerantes) en tablas clave
    const recCols = await tableCols("recomendacion_estandar");
    if (!recCols.length) return res.json({ ok:true, items: [] });

    const colCarne   = pick(recCols, "carne_estudiante", "carne_est", "carne");
    const colStd     = pick(recCols, "id_estandar");
    const colPrio    = pick(recCols, "prioridad", "valor", "peso");
    const colVigente = pick(recCols, "vigente", "activo", "habilitado");
    const colFecha   = pick(recCols, "creado_en", "creado", "fecha", "fecha_creacion");
    const colIdRec   = pick(recCols, "id_rec", "id_recomendacion", "id");

    if (!colCarne || !colStd) return res.json({ ok:true, items: [] });

    // Nombre en Estandar y Area
    const eCols = await tableCols("Estandar");
    const aCols = await tableCols("Area");
    const eName = pick(eCols, "nombre", "nombre_estandar", "titulo", "descripcion") || "id_estandar";
    const aName = pick(aCols, "nombre_area", "nombre", "titulo", "descripcion", "descripcion_area") || "id_area";

    // Armado dinámico con alias estables para el frontend
    const orderPieces = [];
    if (colPrio)  orderPieces.push(`re."${colPrio}" DESC`);
    if (colFecha) orderPieces.push(`re."${colFecha}" DESC`);
    if (!orderPieces.length) orderPieces.push(`e."id_estandar" DESC`);

    const whereVig = colVigente ? `AND re."${colVigente}" = TRUE` : "";

    const sql = `
      SELECT
        ${colIdRec ? `re."${colIdRec}"` : `re."${colStd}"`} AS id,
        e."id_estandar"                                    AS id_estandar,
        e."${eName}"                                       AS titulo,
        a."${aName}"                                       AS area,
        ${colPrio ? `re."${colPrio}"` : "1"}               AS valor,
        a."id_materia"                                     AS id_materia
      FROM "recomendacion_estandar" re
      JOIN "Estandar" e ON e."id_estandar" = re."${colStd}"
      JOIN "Tema" t     ON t."id_tema"     = e."id_tema"
      JOIN "Area" a     ON a."id_area"     = t."id_area"
      WHERE re."${colCarne}" = $1
        ${whereVig}
      ORDER BY ${orderPieces.join(", ")}
      LIMIT $2
    `;

    const { rows } = await db.query(sql, [carne, limit]);

    const items = rows.map(r => ({
      id: r.id,
      id_estandar: r.id_estandar,
      titulo: r.titulo ?? `Estandar ${r.id_estandar}`,
      area: r.area ?? "Área",
      valor: Number(r.valor ?? 0),
      id_materia: r.id_materia ?? null,
      // puedes agregar más campos si luego los usas en UI
    }));

    res.json({ ok:true, items });
  } catch (err) {
    console.warn("[PRACTICAS]", err);
    res.status(500).json({ ok:false, msg: err.message || "No se pudieron cargar las recomendaciones." });
  }
});

// (opcional) mismo handler en la raíz para usar /api/estudiante/practicas?carne=...
router.get("/", (req, res, next) => router.handle({ ...req, url:"/recomendadas" }, res, next));

module.exports = router;
