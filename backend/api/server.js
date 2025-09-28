// backend/api/server.js
import http from "http";
import express from "express";
import cors from "cors";

import sesionesRouter from "./routes/sesiones.js";                 // existente
import docenteEvalRouter from "./routes/docente-evaluaciones.js";  // existente
import estudiantesRouter from "./routes/estudiantes.js";           // NUEVO (nombre/grado del estudiante)
import waitroomRouter from "./routes/waitroom.js";                 // sala de espera (REST)
import attachWaitroom from "./realtime/waitroom.js";               // sala de espera (Socket.IO)

// ---------- Config básica ----------
const app = express();
const PORT = Number(process.env.PORT || 3001);

// Admite varios orígenes separados por coma.
// Ej.: CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
const ORIGINS_ENV =
  process.env.CORS_ORIGINS ||
  process.env.CORS_ORIGIN || // compat
  "http://localhost:5173";

const ORIGINS = ORIGINS_ENV.split(",").map((s) => s.trim()).filter(Boolean);

// Express hardening / parsing
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS (uno o varios orígenes)
app.use(
  cors({
    origin: ORIGINS,
    credentials: true,
  })
);

// ---------- Rutas REST ----------
app.use("/api/sesiones", sesionesRouter);
app.use("/api/docente/evaluaciones", docenteEvalRouter);
app.use("/api/estudiantes", estudiantesRouter); // <- para /api/estudiantes/:id/resumen
app.use("/api/waitroom", waitroomRouter);

// Salud
app.get("/api/ping", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

// ---------- HTTP + Socket.IO ----------
const server = http.createServer(app);
// Socket.IO acepta array en origin
attachWaitroom(server, { corsOrigin: ORIGINS });

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "not_found",
    path: req.originalUrl,
  });
});

// ---------- Manejo de errores ----------
app.use((err, _req, res, _next) => {
  console.error("[API ERROR]", err);
  const status =
    typeof err.status === "number" && err.status >= 400 ? err.status : 500;
  res.status(status).json({
    ok: false,
    error: err.code || "server_error",
    message: err.message || "Se produjo un error en el servidor.",
  });
});

// ---------- Start ----------
server.listen(PORT, () => {
  console.log(`[API] escuchando en http://localhost:${PORT}`);
  console.log(`[API] CORS origins: ${ORIGINS.join(", ")}`);
});
