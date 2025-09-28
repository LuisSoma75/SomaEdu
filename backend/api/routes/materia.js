// backend/api/routes/materia.js
import express from "express";
import pool from "../utils/db.js";
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM "Materia" ORDER BY id_materia');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener las materias" });
  }
});
export default router;
