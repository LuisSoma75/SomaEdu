// backend/App.js
import "dotenv/config";
import { server, PORT as SERVER_PORT } from "./api/server.js";

// Permite sobreescribir el puerto desde .env en este entrypoint
const PORT = Number(process.env.PORT || SERVER_PORT);

// Inicia el servidor de la API (las rutas, CORS, Socket.IO y prefijos
// ya están configurados dentro de backend/api/server.js)
server.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  console.log("Mounted prefixes: /api, /backend/api");
});
