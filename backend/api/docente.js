import express from "express";
import pool from "./utils/db.js"; // Si estás en api/docente.js

const router = express.Router();

router.get("/clases", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c."id_clase", c."Nombre", m."Nombre" AS materia, g."Nombre" AS grado, c."promedio"
      FROM "Clase" c
      JOIN "Materia" m ON c."id_materia" = m."id_materia"
      JOIN "Grado" g ON c."id_grado" = g."id_grado"
    `);
    res.json(result.rows); // [] si no hay clases
  } catch (err) {
    console.error("Error en /api/docente/clases:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
