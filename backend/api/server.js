// backend/api/server.js
import http from "http";
import express from "express";
import cors from "cors";
import { pathToFileURL } from "url";

// Routers
import sesionesRouter from "./routes/sesiones.js";
import docenteEvalRouter from "./routes/docente-evaluaciones.js";
import estudiantesRouter from "./routes/estudiantes.js";
import waitroomRouter from "./routes/waitroom.js";
import adaptativeRouter from "./routes/adaptative.js";
import authRouter from "./routes/auth.js";
// 👇 Listado de evaluaciones para estudiante (por grado)
import estudianteEvalRouter from "./routes/estudiante/estudiante-evaluaciones.js";

// Socket.IO
import attachWaitroom from "./realtime/waitroom.js";

// ================= Config =================
const app = express();
const PORT = Number(process.env.PORT || 3001);
const ORIGINS = (
  process.env.CORS_ORIGINS ||
  process.env.CORS_ORIGIN ||
  "http://localhost:5173"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ================= Middlewares =================
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: ORIGINS,
    credentials: true,
  })
);

// Fix defensivo por si llega /api/api/... etc.
app.use((req, _res, next) => {
  const before = req.url;
  const fixes = [
    ["/api/api/", "/api/"],
    ["/backend/api/api/", "/backend/api/"],
    ["/api/backend/api/", "/backend/api/"],
  ];
  for (const [a, b] of fixes) {
    if (req.url.startsWith(a)) req.url = req.url.replace(a, b);
  }
  if (before !== req.url) console.log(`[fixPrefix] ${before} -> ${req.url}`);
  next();
});

// ================= Montaje de rutas =================
// Prefijo /api
app.use("/api/auth", authRouter);
app.use("/api/sesiones", sesionesRouter);
app.use("/api/docente/evaluaciones", docenteEvalRouter);
app.use("/api/estudiantes", estudiantesRouter);
app.use("/api/estudiante/evaluaciones", estudianteEvalRouter);
app.use("/api/waitroom", waitroomRouter);
app.use("/api/adaptative", adaptativeRouter);
app.get("/api/ping", (_req, res) => res.json({ ok: true, base: "/api" }));

// Prefijo /backend/api (compatibilidad)
app.use("/backend/api/auth", authRouter);
app.use("/backend/api/sesiones", sesionesRouter);
app.use("/backend/api/docente/evaluaciones", docenteEvalRouter);
app.use("/backend/api/estudiantes", estudiantesRouter);
app.use("/backend/api/estudiante/evaluaciones", estudianteEvalRouter);
app.use("/backend/api/waitroom", waitroomRouter);
app.use("/backend/api/adaptative", adaptativeRouter);
app.get("/backend/api/ping", (_req, res) =>
  res.json({ ok: true, base: "/backend/api" })
);

// Health simple en raíz
app.get("/health", (_req, res) => res.json({ ok: true }));

// ================= HTTP + Socket.IO =================
const server = http.createServer(app);
// Adjuntar Socket.IO (no abre puerto por sí solo)
attachWaitroom(server, { corsOrigin: ORIGINS, path: "/socket.io" });

// ================= 404 =================
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "not_found",
    path: req.originalUrl,
  });
});

// ================= Errores =================
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

// ================= Start (solo si es entrypoint) =================
let isDirectRun = false;
try {
  const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
  isDirectRun = import.meta.url === entryHref;
} catch {
  isDirectRun = false;
}

if (isDirectRun) {
  server.listen(PORT, () => {
    console.log(`[API] escuchando en http://localhost:${PORT}`);
    console.log(`[API] CORS origins: ${ORIGINS.join(", ")}`);
    console.log("Mounted prefixes: /api, /backend/api");
  });
}

// Exporta para que otros entrypoints (p. ej. backend/App.js) puedan reutilizar
export { app, server, PORT, ORIGINS };
