// backend/App.js
import "dotenv/config";
import express from "express";
import cors from "cors";

// Rutas existentes
import authRouter from "./api/routes/auth.js";
import docenteRouter from "./api/routes/docente.js";
import gradoRouter from "./api/routes/grado.js";
import materiaRouter from "./api/routes/materia.js";
import clasesRouter from "./api/routes/clases.js";
import estudiantesRouter from "./api/routes/estudiantes.js";
import usuariosRouter from "./api/routes/usuarios.js";
import adaptiveRouter from "./api/routes/adaptative.js"; // ojo con el nombre del archivo
import sesionesRouter from "./api/routes/sesiones.js";

// NUEVA ruta para la tabla de evaluaciones del docente
import docenteEvaluacionesRouter from "./api/routes/docente-evaluaciones.js";

// ==== Portal Estudiante (si los usas) ====
import estudianteDashboardRouter     from "./api/routes/estudiante/dashboard.js";
import evaluacionesDisponiblesRouter from "./api/routes/estudiante/evaluaciones.js";
import historialEvaluacionRouter     from "./api/routes/estudiante/historial.js";
import perfilEstudianteRouter        from "./api/routes/estudiante/perfil.js";
import reporteDesempenoRouter        from "./api/routes/estudiante/reporte.js";
// =========================================

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Health
app.get("/health", (_, res) => res.json({ ok: true }));

// DB ping
app.get("/db-ping", async (_req, res) => {
  try {
    const pg = (await import("./api/utils/db.js")).default;
    const r = await pg.query(`
      select current_database() as db,
             current_user as usr,
             inet_server_addr() as host,
             inet_server_port() as port,
             now() as now
    `);
    res.json({ ok: true, ...r.rows[0] });
  } catch (e) {
    console.error("db-ping error:", e);
    res.status(500).json({ ok: false, error: "db_ping_failed" });
  }
});

// Rutas API (existentes)
app.use("/api/auth", authRouter);
app.use("/api/docente", docenteRouter);
app.use("/api/grados", gradoRouter);
app.use("/api/materias", materiaRouter);
app.use("/api/clases", clasesRouter);
app.use("/api/estudiantes", estudiantesRouter);
app.use("/api/usuarios", usuariosRouter);
app.use("/api/adaptive", adaptiveRouter);
app.use("/api/sesiones", sesionesRouter);

// NUEVA: evaluaciones agregadas por sesión (para la tabla)
app.use("/api/docente/evaluaciones", docenteEvaluacionesRouter);

// Portal Estudiante
app.use("/api/estudiante/dashboard", estudianteDashboardRouter);
app.use("/api/estudiante/evaluaciones", evaluacionesDisponiblesRouter);
app.use("/api/estudiante/historial", historialEvaluacionRouter);
app.use("/api/estudiante/perfil", perfilEstudianteRouter);
app.use("/api/estudiante/reporte", reporteDesempenoRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not_found", path: req.originalUrl });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "server_error" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
