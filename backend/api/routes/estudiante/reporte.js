import { Router } from "express";
const r = Router();
r.get("/", (req, res) => res.json({ ok: true, data: { kpis: { progreso:68, asistencia:90 } }}));
export default r;
