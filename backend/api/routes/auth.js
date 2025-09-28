import express from "express";
import pool from "../utils/db.js"; // Cambia la ruta si está en otro lugar
import bcrypt from "bcryptjs";

const router = express.Router();

router.post("/login", async (req, res) => {
  // 1. Imprime el body recibido
  console.log("🟡 [LOGIN] Body recibido:", req.body);

  const { correo, contraseña } = req.body;
  if (!correo || !contraseña) {
    console.log("🔴 [LOGIN] Falta correo o contraseña");
    return res.json({ success: false, message: "Correo y contraseña son obligatorios" });
  }

  try {
    // 2. Imprime la consulta que se hará
    console.log('🔵 [LOGIN] Consultando usuario en BD...');
    // OJO: Asegúrate que el nombre de la tabla y columna sean EXACTOS ("Usuarios" y correo)
    const result = await pool.query('SELECT * FROM "Usuarios" WHERE correo = $1', [correo]);
    console.log("🟣 [LOGIN] Resultado SQL:", result.rows);

    if (result.rows.length === 0) {
      console.log("🔴 [LOGIN] Usuario no encontrado");
      return res.json({ success: false, message: "Usuario no encontrado" });
    }

    const usuario = result.rows[0];
    // 3. Imprime para depurar contraseña (NO imprimas hashes reales en producción)
    console.log("🟢 [LOGIN] Verificando contraseña...");
    console.log("Contraseña recibida:", contraseña);
    console.log("Hash en base:", usuario.contraseña);

    const passwordOk = await bcrypt.compare(contraseña, usuario.contraseña);

    if (!passwordOk) {
      console.log("🔴 [LOGIN] Contraseña incorrecta");
      return res.json({ success: false, message: "Contraseña incorrecta" });
    }

    // 4. Si todo va bien, imprime el rol y devuelve también el nombre y el id de usuario
    console.log("✅ [LOGIN] Login correcto. id_rol:", usuario.id_rol);

    console.log("RESPUESTA DE LOGIN:", {
  nombre: usuario.Nombre,
  // otros campos...
});

    res.json({
      success: true,
      id_rol: usuario.id_rol,
      id_usuario: usuario.id_usuario,     // Por si necesitas el id del usuario
      nombre: usuario.Nombre,             // Devuelve el nombre exacto para mostrarlo en frontend
      correo: usuario.correo              // (Opcional) Devuelve el correo si lo quieres guardar también
    });
  } catch (error) {
    // 5. Error inesperado
    console.error("❌ [LOGIN] Error inesperado:", error);
    res.status(500).json({ success: false, message: "Error interno del servidor" });
  }
});

export default router;
