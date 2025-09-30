// backend/api/routes/estudiantes.js
import express from "express";
import db from "../utils/db.js";
import bcrypt from "bcrypt";

const router = express.Router();

/* ===========================
   Helpers
=========================== */
function required(body, keys) {
  const missing = keys.filter(
    (k) => body[k] === undefined || body[k] === null || body[k] === ""
  );
  return { ok: missing.length === 0, missing };
}
function toInt(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

/* =========================================================
   Consulta base: sesiones disponibles para un id_grado
   (¡OJO con c."Nombre" en vez de c.nombre!)
========================================================= */
async function listSesionesParaEstudiante(idGrado) {
  const q = await db.query(
    `
    SELECT
      se."id_sesion",
      se."nombre"                        AS titulo,
      se."estado",
      se."creado_en",
      se."iniciado_en",
      se."finalizado_en",
      se."tiempo_limite_seg",
      se."num_preg_max",
      se."modo_adaptativo",
      se."pin",
      c."id_clase",
      c."id_grado",
      COALESCE(c."Nombre",'—')           AS clase_nombre  -- FIX: columna con mayúscula
    FROM "Sesion_evaluacion" se
    JOIN "Clase" c
      ON c."id_clase" = se."id_clase"
    WHERE c."id_grado" = $1
      AND se."estado" IN ('programada','en_espera')
    ORDER BY se."creado_en" DESC
    `,
    [idGrado]
  );

  return q.rows.map((r) => {
    let modalidad = "hasta_detener";
    if (r.tiempo_limite_seg) modalidad = "tiempo";
    else if (r.num_preg_max) modalidad = "num_preguntas";
    return {
      id_sesion: Number(r.id_sesion),
      titulo: r.titulo,
      estado: r.estado,
      fecha: r.creado_en,
      iniciado_en: r.iniciado_en,
      finalizado_en: r.finalizado_en,
      modalidad,
      num_preg_max: r.num_preg_max,
      tiempo_limite_seg: r.tiempo_limite_seg,
      modo_adaptativo: r.modo_adaptativo,
      pin: r.pin,
      id_clase: r.id_clase,
      id_grado: r.id_grado,
      clase_nombre: r.clase_nombre,
    };
  });
}

/* ===========================
   POST /api/estudiantes
   Crea Usuario + Estudiante
=========================== */
/**
 * Body:
 * {
 *   "usuario": {
 *     "nombre": "Ana Morales",
 *     "correo": "ana@colegio.edu.gt",
 *     "contrasena": "Ana2025*",    // o "contraseña"
 *     "codigo_establecimiento": "EST001",
 *     "id_rol": 3,                 // 3 = estudiante
 *     "estado": "activo"
 *   },
 *   "estudiante": {
 *     "carne_estudiante": "C-0001",
 *     "id_grado": 1
 *   }
 * }
 */
router.post("/", async (req, res) => {
  const client = await db.connect();
  try {
    const { usuario, estudiante } = req.body || {};
    if (!usuario || !estudiante) {
      return res
        .status(400)
        .json({ ok: false, error: "faltan_bloques_usuario_estudiante" });
    }

    const {
      nombre,
      correo,
      contrasena,
      contraseña,
      codigo_establecimiento,
      id_rol,
      estado,
    } = usuario;

    const pwd = contrasena ?? contraseña;
    const { carne_estudiante, id_grado } = estudiante;

    const v1 = required(
      {
        nombre,
        correo,
        pwd,
        codigo_establecimiento,
        id_rol,
        carne_estudiante,
        id_grado,
      },
      [
        "nombre",
        "correo",
        "pwd",
        "codigo_establecimiento",
        "id_rol",
        "carne_estudiante",
        "id_grado",
      ]
    );
    if (!v1.ok) {
      return res
        .status(400)
        .json({ ok: false, error: "campos_obligatorios", missing: v1.missing });
    }

    const correoNorm = String(correo).trim().toLowerCase();
    const idRol = toInt(id_rol);
    const idGrado = toInt(id_grado);
    if (!idRol || !idGrado) {
      return res.status(400).json({ ok: false, error: "ids_invalidos" });
    }

    if (String(pwd).length < 6) {
      return res.status(400).json({ ok: false, error: "password_debil_min6" });
    }

    const hash = await bcrypt.hash(pwd, 12);

    await client.query("BEGIN");

    // Duplicados por correo
    const dupU = await client.query(
      `SELECT 1 FROM "Usuarios" WHERE LOWER(correo)=LOWER($1) LIMIT 1`,
      [correoNorm]
    );
    if (dupU.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "correo_ya_registrado" });
    }

    // Duplicados por carné
    const dupC = await client.query(
      `SELECT 1 FROM "Estudiantes" WHERE carne_estudiante=$1 LIMIT 1`,
      [carne_estudiante]
    );
    if (dupC.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "carne_ya_registrado" });
    }

    // Inserta Usuario
    const ures = await client.query(
      `INSERT INTO "Usuarios" ("Nombre", correo, contraseña, fecha_registro, codigo_establecimiento, id_rol, estado)
       VALUES ($1,$2,$3, NOW(), $4,$5, COALESCE($6,'activo'))
       RETURNING id_usuario`,
      [nombre, correoNorm, hash, codigo_establecimiento, idRol, estado]
    );
    const id_usuario = ures.rows[0].id_usuario;

    // Inserta Estudiante
    await client.query(
      `INSERT INTO "Estudiantes" (carne_estudiante, id_usuario, id_grado)
       VALUES ($1,$2,$3)`,
      [carne_estudiante, id_usuario, idGrado]
    );

    await client.query("COMMIT");
    return res.status(201).json({ ok: true, id_usuario, carne_estudiante });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /api/estudiantes error:", e);
    if (e.code === "23505") {
      return res
        .status(409)
        .json({ ok: false, error: "duplicado", detail: e.detail });
    }
    return res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});

/* =========================================
   GET /api/estudiantes/by-user/:id/resumen
========================================= */
router.get("/by-user/:id/resumen", async (req, res, next) => {
  try {
    const idUsuario = toInt(req.params.id);
    if (!idUsuario)
      return res.status(400).json({ ok: false, error: "id_invalido" });

    const sql = `
      SELECT
        e.carne_estudiante,
        TRIM(u."Nombre") AS nombre_completo,
        g."Nombre"       AS grado
      FROM "Estudiantes" e
      JOIN "Usuarios" u ON u.id_usuario = e.id_usuario
      LEFT JOIN "Grado" g ON g."id_grado" = e."id_grado"
      WHERE e.id_usuario = $1
      LIMIT 1;
    `;
    const { rows } = await db.query(sql, [idUsuario]);
    if (!rows.length) {
      return res
        .status(404)
        .json({ ok: false, error: "estudiante_no_encontrado" });
    }

    const r = rows[0];
    res.json({
      ok: true,
      data: {
        carne_estudiante: r.carne_estudiante,
        nombre_completo: r.nombre_completo || "Estudiante",
        grado: r.grado || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================
   GET /api/estudiantes/by-user/:id/grado-simple
========================================= */
router.get("/by-user/:id/grado-simple", async (req, res, next) => {
  try {
    const idUsuario = toInt(req.params.id);
    if (!idUsuario)
      return res.status(400).json({ ok: false, error: "id_invalido" });

    const sql = `
      SELECT g."Nombre" AS grado
      FROM "Estudiantes" e
      LEFT JOIN "Grado" g ON g."id_grado" = e."id_grado"
      WHERE e.id_usuario = $1
      LIMIT 1;
    `;
    const { rows } = await db.query(sql, [idUsuario]);
    res.json({ ok: true, data: { grado: rows[0]?.grado ?? null } });
  } catch (err) {
    next(err);
  }
});

/* =========================================
   GET /api/estudiantes/by-carne/:carne/resumen
========================================= */
router.get("/by-carne/:carne/resumen", async (req, res, next) => {
  try {
    const carne = String(req.params.carne);
    if (!carne)
      return res.status(400).json({ ok: false, error: "carne_invalido" });

    const sql = `
      SELECT
        e.carne_estudiante,
        TRIM(u."Nombre") AS nombre_completo,
        g."Nombre"       AS grado
      FROM "Estudiantes" e
      JOIN "Usuarios" u ON u.id_usuario = e.id_usuario
      LEFT JOIN "Grado" g ON g."id_grado" = e."id_grado"
      WHERE e.carne_estudiante = $1
      LIMIT 1;
    `;
    const { rows } = await db.query(sql, [carne]);
    if (!rows.length) {
      return res
        .status(404)
        .json({ ok: false, error: "estudiante_no_encontrado" });
    }

    const r = rows[0];
    res.json({
      ok: true,
      data: {
        carne_estudiante: r.carne_estudiante,
        nombre_completo: r.nombre_completo || "Estudiante",
        grado: r.grado || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================
   GET /api/estudiantes/by-carne/:carne
========================================= */
router.get("/by-carne/:carne", async (req, res, next) => {
  try {
    const carne = String(req.params.carne);
    if (!carne)
      return res.status(400).json({ ok: false, error: "carne_invalido" });

    const sql = `
      SELECT
        e.carne_estudiante,
        e.id_usuario,
        e.id_grado,
        u."Nombre" AS nombre,
        u.correo,
        u.codigo_establecimiento,
        u.id_rol,
        u.estado,
        g."Nombre" AS grado_nombre
      FROM "Estudiantes" e
      JOIN "Usuarios" u ON u.id_usuario = e.id_usuario
      LEFT JOIN "Grado" g ON g."id_grado" = e."id_grado"
      WHERE e.carne_estudiante = $1
      LIMIT 1;
    `;
    const { rows } = await db.query(sql, [carne]);
    if (!rows.length) {
      return res
        .status(404)
        .json({ ok: false, error: "estudiante_no_encontrado" });
    }

    const r = rows[0];
    res.json({
      ok: true,
      data: {
        carne_estudiante: r.carne_estudiante,
        id_usuario: Number(r.id_usuario),
        id_grado: r.id_grado !== null ? Number(r.id_grado) : null,
        grado_nombre: r.grado_nombre ?? null,
        usuario: {
          nombre: r.nombre,
          correo: r.correo,
          codigo_establecimiento: r.codigo_establecimiento,
          id_rol: Number(r.id_rol),
          estado: r.estado,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   GET /api/estudiantes/:id/evaluaciones  (por id_estudiante)
========================================================= */
router.get("/:id/evaluaciones", async (req, res, next) => {
  try {
    const idEst = toInt(req.params.id);
    if (!idEst || idEst <= 0) {
      return res
        .status(400)
        .json({ ok: false, error: "id_estudiante_invalido" });
    }

    const g = await db.query(
      `SELECT e."id_grado" FROM "Estudiantes" e WHERE e."id_estudiante" = $1 LIMIT 1`,
      [idEst]
    );
    const idGrado = g.rows[0]?.id_grado ?? null;
    if (!idGrado) {
      return res.status(404).json({ ok: false, error: "grado_no_encontrado" });
    }

    const items = await listSesionesParaEstudiante(idGrado);
    res.json({ ok: true, items });
  } catch (err) {
    console.error("[GET /api/estudiantes/:id/evaluaciones]", err);
    next(err);
  }
});

/* =========================================================
   GET /api/estudiantes/by-user/:id/evaluaciones  (por id_usuario)
========================================================= */
router.get("/by-user/:id/evaluaciones", async (req, res, next) => {
  try {
    const idUsuario = Number(req.params.id);
    if (!Number.isFinite(idUsuario) || idUsuario <= 0) {
      return res.status(400).json({ ok: false, error: "id_usuario_invalido" });
    }

    const g = await db.query(
      `SELECT e."id_grado" FROM "Estudiantes" e WHERE e."id_usuario" = $1 LIMIT 1`,
      [idUsuario]
    );
    const idGrado = g.rows[0]?.id_grado ?? null;
    if (!idGrado) {
      return res.status(404).json({ ok: false, error: "grado_no_encontrado" });
    }

    const items = await listSesionesParaEstudiante(idGrado);
    res.json({ ok: true, items });
  } catch (err) {
    console.error("[GET /api/estudiantes/by-user/:id/evaluaciones]", err);
    next(err);
  }
});

export default router;
