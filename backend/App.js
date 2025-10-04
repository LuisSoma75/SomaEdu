// backend/App.js
import "dotenv/config";
import express from "express";
import cors from "cors";

// ===== Rutas =====
import authRouter from "./api/routes/auth.js";
import docenteRouter from "./api/routes/docente.js";
import gradoRouter from "./api/routes/grado.js";
import materiaRouter from "./api/routes/materia.js";
import clasesRouter from "./api/routes/clases.js";
import estudiantesRouter from "./api/routes/estudiantes.js";
import usuariosRouter from "./api/routes/usuarios.js";
import adaptiveRouter from "./api/routes/adaptative.js"; // ojo: nombre del archivo
import sesionesRouter from "./api/routes/sesiones.js";
import docenteEvaluacionesRouter from "./api/routes/docente-evaluaciones.js";

// Portal Estudiante
import estudianteDashboardRouter    from "./api/routes/estudiante/dashboard.js";
// ⬇️ usa el archivo nuevo:
import estudianteEvaluacionesRouter from "./api/routes/estudiante/estudiante-evaluaciones.js";
import historialEvaluacionRouter    from "./api/routes/estudiante/historial.js";
import perfilEstudianteRouter       from "./api/routes/estudiante/perfil.js";
import reporteDesempenoRouter       from "./api/routes/estudiante/reporte.js";

const app = express();
const PREFIXES = ["/backend/api", "/api"]; // montamos en ambos

/* ============ CORS ============ */
app.use(cors());

/* ============ Parsers ============ */
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* ============ Parachoques /api/api -> /api (y backend/api/api -> backend/api) ============ */
// (antes del logger)
app.use((req, _res, next) => {
  const original = req.url;

  // /api/api/... -> /api/...
  if (req.url.startsWith("/api/api/")) req.url = req.url.replace("/api/api/", "/api/");
  else if (req.url === "/api/api") req.url = "/api";

  // /backend/api/api/... -> /backend/api/...
  if (req.url.startsWith("/backend/api/api/")) {
    req.url = req.url.replace("/backend/api/api/", "/backend/api/");
  } else if (req.url === "/backend/api/api") {
    req.url = "/backend/api";
  }

  if (original !== req.url) console.log(`[fixPrefix] ${original} -> ${req.url}`);
  next();
});

/* ============ Logger simple (con ID y tiempo) ============ */
app.use((req, res, next) => {
  const id = Math.random().toString(36).slice(2, 8).toUpperCase();
  const t0 = Date.now();

  // limpiar body (no loguear contraseña)
  let safeBody = undefined;
  if (req.is("application/json")) {
    const { password, contrasena, contraseña, ...rest } = req.body || {};
    safeBody = rest;
  }

  console.log(`[REQ ${id}] ${req.method} ${req.originalUrl}`);
  if (safeBody && Object.keys(safeBody).length) {
    console.log(`[REQ ${id}] body:`, safeBody);
  }
  if (req.query && Object.keys(req.query).length) {
    console.log(`[REQ ${id}] query:`, req.query);
  }

  const end = res.end;
  res.end = function (...args) {
    res.end = end;
    const ms = Date.now() - t0;
    console.log(`[RES ${id}] ${res.statusCode} ${req.method} ${req.originalUrl} (${ms}ms)`);
    return res.end(...args);
  };
  next();
});

/* ============ Health/DB ping ============ */
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/db-ping", async (_req, res) => {
  try {
    const db = (await import("./api/utils/db.js")).default;
    const r = await db.query(`
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

// Helpers para montar rutas bajo varios prefijos
function mount(prefix, path, router) {
  app.use(`${prefix}${path}`, router);
}
function mountAll(prefix) {
  mount(prefix, "/auth", authRouter);
  mount(prefix, "/docente", docenteRouter);
  mount(prefix, "/grados", gradoRouter);
  mount(prefix, "/materias", materiaRouter);
  mount(prefix, "/clases", clasesRouter);
  mount(prefix, "/estudiantes", estudiantesRouter);
  mount(prefix, "/usuarios", usuariosRouter);
  mount(prefix, "/adaptive", adaptiveRouter);
  mount(prefix, "/sesiones", sesionesRouter);
  mount(prefix, "/docente/evaluaciones", docenteEvaluacionesRouter);

  // Portal estudiante
  mount(prefix, "/estudiante/dashboard",    estudianteDashboardRouter);
  mount(prefix, "/estudiante/evaluaciones", estudianteEvaluacionesRouter); // ⬅️ nuevo
  mount(prefix, "/estudiante/historial",    historialEvaluacionRouter);
  mount(prefix, "/estudiante/perfil",       perfilEstudianteRouter);
  mount(prefix, "/estudiante/reporte",      reporteDesempenoRouter);

  // Atajos de health/db-ping bajo el prefijo
  app.get(`${prefix}/health`, (_req, res) => res.json({ ok: true, prefixed: prefix }));
  app.get(`${prefix}/db-ping`, async (_req, res) => {
    try {
      const db = (await import("./api/utils/db.js")).default;
      const r = await db.query(`select now() as now`);
      res.json({ ok: true, ...r.rows[0] });
    } catch (e) {
      console.error("db-ping error:", e);
      res.status(500).json({ ok: false, error: "db_ping_failed" });
    }
  });
}

// Montar en ambos prefijos
for (const p of PREFIXES) mountAll(p);

/* ============ 404 ============ */
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not_found", path: req.originalUrl });
});

/* ============ Manejador de errores ============ */
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "server_error" });
});

/* ============ Start ============ */
const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  console.log(`Mounted prefixes: ${PREFIXES.join(", ")}`);
});
