// backend/api/routes/grado.js
import express from "express";
import pool from "../utils/db.js";
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM "Grado" ORDER BY id_grado');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener los grados" });
  }
});
export default router;
