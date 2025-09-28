import { Router } from "express";
const r = Router();
r.get("/", (req, res) => res.json({ ok: true, data: [
  { id:"h1", titulo:"Quiz Álgebra", score:84, fecha:"2025-08-24" }
]}));
export default r;
