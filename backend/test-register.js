import pool from "./api/utils/db.js";
import bcrypt from "bcrypt";

async function insertarUsuario(nombre, correo, passwordPlano, codigo_establecimiento, id_rol, estado) {
  const hash = await bcrypt.hash(passwordPlano, 10);
  await pool.query(
  `INSERT INTO "Usuarios" ("Nombre", correo, contraseña, fecha_registro, codigo_establecimiento, id_rol, estado)
   VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
  [nombre, correo, hash, codigo_establecimiento, id_rol, estado]
  );
}

async function main() {
  await insertarUsuario("Ana Admin", "ana.admin@correo.com", "admin123", "EST001", 1, "activo");
  await insertarUsuario("Pedro Estudiante", "pedro.estudiante@correo.com", "estudiante123", "EST001", 3, "activo");
  process.exit();
}

main();
