// backend/App.js
import "dotenv/config";
import { server, PORT as SERVER_PORT, ORIGINS } from "./api/server.js";

// Permite sobreescribir el puerto desde .env en este entrypoint
const PORT = Number(process.env.PORT || SERVER_PORT);

// Inicia el servidor de la API (las rutas, CORS, Socket.IO y prefijos
// ya están configurados dentro de backend/api/server.js)
server.listen(PORT, () => {
  console.log(`[API] running on http://localhost:${PORT}`);
  if (Array.isArray(ORIGINS)) {
    console.log(`[API] CORS origins: ${ORIGINS.join(", ")}`);
  }
  console.log("[API] Mounted prefixes: /api, /backend/api");
});

// Manejo básico de errores de arranque
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[API] El puerto ${PORT} ya está en uso.`);
  } else {
    console.error("[API] Error al iniciar el servidor:", err);
  }
  process.exit(1);
});

// Apagado elegante
const shutdown = (sig) => {
  console.log(`[API] Señal ${sig} recibida. Cerrando...`);
  server.close(() => {
    console.log("[API] Servidor cerrado.");
    process.exit(0);
  });
  // Forzar cierre si algo queda colgado
  setTimeout(() => {
    console.warn("[API] Forzando cierre.");
    process.exit(1);
  }, 5000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
