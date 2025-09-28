import express from "express";
import pool from "../utils/db.js";
const router = express.Router();

// Obtener clases del docente
router.get("/clases/:id_usuario", async (req, res) => {
  const id_usuario = req.params.id_usuario;
  try {
    const result = await pool.query(`
      SELECT
        c.id_clase,
        m."Nombre" AS materia,
        g."Nombre" AS grado,
        COUNT(e.carne_estudiante) AS estudiantes
      FROM "Clase" c
      JOIN "Docente_Clase" dc ON c.id_clase = dc.id_clase
      JOIN "Docentes" d ON dc.dpi = d.dpi
      JOIN "Materia" m ON c.id_materia = m.id_materia
      JOIN "Grado" g ON c.id_grado = g.id_grado
      LEFT JOIN "Estudiantes" e ON e.id_grado = g.id_grado
      WHERE d.id_usuario = $1
      GROUP BY c.id_clase, m."Nombre", g."Nombre"
      ORDER BY g."Nombre", m."Nombre"
    `, [id_usuario]);
    res.json(result.rows);
  } catch (error) {
    console.error("Error en /api/docente/clases/:id_usuario:", error);
    res.status(500).json({ error: "Error al obtener las clases del docente" });
  }
});

export default router;
