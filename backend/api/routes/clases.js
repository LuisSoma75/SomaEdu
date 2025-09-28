import express from "express";
const router = express.Router();
import pool from "../utils/db.js"; // Cambia el path si es necesario

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        c.id_clase, 
        c."Nombre" AS clase_nombre,
        c.id_materia,
        m."Nombre" AS materia_nombre,
        c.id_grado,
        g."Nombre" AS grado_nombre,
        c.promedio
      FROM "Clase" c
      JOIN "Materia" m ON c.id_materia = m.id_materia
      JOIN "Grado" g ON c.id_grado = g.id_grado
      ORDER BY c.id_clase
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo clases:', err);
    res.status(500).json({ error: 'Error obteniendo las clases' });
  }
});

export default router;
