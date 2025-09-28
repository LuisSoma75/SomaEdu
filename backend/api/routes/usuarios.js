import express from "express";
import pool from "../utils/db.js";
import bcrypt from "bcrypt";

const router = express.Router();

router.post("/", async (req, res) => {
  // Log útil mientras pruebas
  console.log("HEADERS:", req.headers);
  console.log("BODY:", req.body);

  // Normalización de campos
  const nombre  = (req.body.nombre ?? "").toString().trim();
  const correo  = (req.body.correo ?? "").toString().trim();
  const pwdRaw  = req.body.contrasena ?? req.body["contraseña"] ?? req.body.password;
  const estado  = (req.body.estado ?? "activo").toString().trim();

  // Foráneas numéricas (acepta "3" como string)
  const id_establecimiento = Number(req.body.id_establecimiento);
  const id_rol = Number(req.body.id_rol);

  const faltantes = [];
  if (!nombre) faltantes.push("nombre");
  if (!correo) faltantes.push("correo");
  if (!pwdRaw || `${pwdRaw}`.trim() === "") faltantes.push("contrasena");
  if (!Number.isFinite(id_establecimiento)) faltantes.push("id_establecimiento");
  if (!Number.isFinite(id_rol)) faltantes.push("id_rol");

  if (faltantes.length) {
    return res.status(400).json({ ok: false, error: "Campos obligatorios incompletos", faltantes });
  }

  const hash = await bcrypt.hash(`${pwdRaw}`.trim(), 12);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const q = `
      INSERT INTO "Usuarios"
        ("Nombre", correo, "contraseña", fecha_registro, id_establecimiento, id_rol, estado)
      VALUES
        ($1, $2, $3, NOW(), $4, $5, $6)
      RETURNING id_usuario, "Nombre", correo, id_establecimiento, id_rol, estado, fecha_registro
    `;
    const { rows } = await client.query(q, [
      nombre, correo, hash, id_establecimiento, id_rol, estado || "activo"
    ]);
    await client.query("COMMIT");
    return res.status(201).json({ ok: true, usuario: rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /api/usuarios error:", e);
    if (e.code === "23503") return res.status(409).json({ ok: false, error: "fk_violation", detail: e.detail });
    if (e.code === "23505") return res.status(409).json({ ok: false, error: "duplicado", detail: e.detail });
    return res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});

export default router;
