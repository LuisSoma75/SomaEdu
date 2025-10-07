// backend/ia/App.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import { createRequire } from "module";

// Reusa tu servicio IA existente (CommonJS) SIN levantar la API
const require = createRequire(import.meta.url);
const IA = require("../api/services/ia.cjs"); // <- usa tu lógica IA ya escrita

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "ia" }));

// Endpoint opcional para testear el rankeo desde Postman
app.post("/ia/rank", async (req, res) => {
  try {
    const { id_materia, target_valor, exclude = [], k = 1 } = req.body || {};
    const out = await IA.rank({
      id_materia: Number(id_materia),
      target_valor: Number(target_valor),
      exclude: Array.isArray(exclude) ? exclude : [],
      k: Number(k || 1),
    });
    res.json({ ok: true, ...out });
  } catch (e) {
    console.error("[IA] rank error:", e);
    res.status(500).json({ ok: false, error: "ia_error", message: e.message });
  }
});

// Puerto propio (no 3001)
const PORT = Number(process.env.PORT || process.env.IA_PORT || 3002);
app.listen(PORT, () => {
  console.log(`[IA] listening on http://localhost:${PORT}`);
});
