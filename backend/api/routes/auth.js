// backend/api/routes/auth.js
import express from "express";
import db from "../utils/db.js";
import bcrypt from "bcryptjs"; // o "bcrypt" si así lo tienes instalado

const router = express.Router();

/**
 * POST /login
 * Body: { correo, contrasena | contraseña }
 */
router.post("/login", async (req, res) => {
  try {
    const { correo, contrasena, contraseña } = req.body || {};
    const pwd = contrasena ?? contraseña;
    if (!correo || !pwd) {
      return res
        .status(400)
        .json({ ok: false, error: "missing_fields", message: "Correo y contraseña son obligatorios." });
    }

    // 1) Busca usuario por correo
    const u = await db.query(
      `SELECT u.id_usuario, u."Nombre" AS nombre, u.correo, u.contraseña AS hash, u.id_rol
         FROM "Usuarios" u
        WHERE LOWER(u.correo) = LOWER($1)
        LIMIT 1`,
      [correo]
    );
    if (u.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "not_found", message: "Usuario no encontrado." });
    }
    const user = u.rows[0];

    // 2) Verifica contraseña
    const ok = await bcrypt.compare(pwd, user.hash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "bad_credentials", message: "Contraseña incorrecta." });
    }

    // 3) Trae datos de Estudiantes (si aplica)
    const e = await db.query(
      `SELECT e.carne_estudiante, e.id_grado, g."Nombre" AS grado_nombre
         FROM "Estudiantes" e
    LEFT JOIN "Grado" g ON g."id_grado" = e."id_grado"
        WHERE e.id_usuario = $1
        LIMIT 1`,
      [user.id_usuario]
    );
    const est = e.rows[0] || null;

    // 4) Respuesta normalizada (sin id_estudiante)
    return res.json({
      ok: true,
      user: {
        id_usuario: Number(user.id_usuario),
        id_rol: Number(user.id_rol),
        nombre: user.nombre,
        correo: user.correo,
        // datos de estudiante si existen
        carne_estudiante: est?.carne_estudiante ?? null,
        id_grado: est?.id_grado != null ? Number(est.id_grado) : null,
        grado_nombre: est?.grado_nombre ?? null,
      },
    });
  } catch (err) {
    console.error("[LOGIN] error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
