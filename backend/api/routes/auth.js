// backend/api/routes/auth.js
import express from "express";
import db from "../utils/db.js";     // ⬅️ usa el wrapper con db.query(...)
import bcrypt from "bcryptjs";

const router = express.Router();

/** Normaliza credenciales desde el body */
function parseCredentials(body = {}) {
  const correo =
    (body.correo ?? body.email ?? body.usuario ?? "").toString().trim();
  const password =
    (body.password ?? body.contrasena ?? body["contraseña"] ?? "").toString();
  return { correo, password };
}

/**
 * POST /api/auth/login
 * Body: { correo|email , password|contrasena|contraseña }
 */
router.post("/login", async (req, res) => {
  const t0 = Date.now();

  // 🔸 Logs de entrada (sin imprimir contraseña)
  const { correo, password } = parseCredentials(req.body || {});
  console.log("🟡 [LOGIN] intento:", { correo });

  if (!correo || !password) {
    console.log("🔴 [LOGIN] missing_fields");
    return res.status(400).json({
      ok: false,
      error: "missing_fields",
      message: "Correo y contraseña son obligatorios",
    });
  }

  try {
    // 1) Buscar usuario por correo (case-insensitive)
    const sqlUser = `
      SELECT
        u."id_usuario"   AS id_usuario,
        u."Nombre"       AS nombre,
        u."correo"       AS correo,
        u."contraseña"   AS hash,
        u."id_rol"       AS id_rol
      FROM "Usuarios" u
      WHERE LOWER(u."correo") = LOWER($1)
      LIMIT 1
    `;
    console.log("🔵 [LOGIN] consultando usuario...");
    const u = await db.query(sqlUser, [correo]);
    console.log("🟣 [LOGIN] rows:", u.rowCount);

    if (u.rowCount === 0) {
      console.log("🔴 [LOGIN] not_found:", correo);
      return res.status(404).json({
        ok: false,
        error: "not_found",
        message: "Usuario no encontrado",
      });
    }

    const user = u.rows[0];

    // 2) Verificar contraseña
    console.log("🟢 [LOGIN] verificando contraseña (bcrypt)...");
    const okPass = await bcrypt.compare(password, user.hash || "");
    console.log("🟢 [LOGIN] bcrypt.compare =>", okPass);

    if (!okPass) {
      console.log("🔴 [LOGIN] bad_credentials para id_usuario:", user.id_usuario);
      return res.status(401).json({
        ok: false,
        error: "bad_credentials",
        message: "Contraseña incorrecta",
      });
    }

    // 3) (Opcional) Si es estudiante, traer datos relacionados
    const sqlEst = `
      SELECT
        e."carne_estudiante" AS carne_estudiante,
        e."id_grado"         AS id_grado,
        g."Nombre"           AS grado_nombre
      FROM "Estudiantes" e
      LEFT JOIN "Grado" g
        ON g."id_grado" = e."id_grado"
      WHERE e."id_usuario" = $1
      LIMIT 1
    `;
    const e = await db.query(sqlEst, [user.id_usuario]);
    console.log("🔵 [LOGIN] filas de Estudiantes:", e.rowCount);
    const est = e.rows[0] || null;

    // 4) Respuesta normalizada para el frontend
    const payload = {
      id_usuario: Number(user.id_usuario),
      id_rol: Number(user.id_rol),           // 1 admin, 2 docente, 3 estudiante (según tu lógica)
      nombre: user.nombre,
      correo: user.correo,
      carne_estudiante: est?.carne_estudiante ?? null,
      id_grado: est?.id_grado != null ? Number(est.id_grado) : null,
      grado_nombre: est?.grado_nombre ?? null,
    };

    console.log(
      `✅ [LOGIN] ok (id_usuario=${payload.id_usuario}, rol=${payload.id_rol}) en ${Date.now() - t0}ms`
    );

    return res.json({ ok: true, user: payload });
  } catch (error) {
    console.error("❌ [LOGIN] error inesperado:", error);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
