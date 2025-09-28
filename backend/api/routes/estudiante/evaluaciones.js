import { Router } from "express";
const r = Router();
r.get("/", (req, res) => res.json({ ok: true, data: [
  { id:"ev1", titulo:"Adaptativa CNB", estado:"disponible" }
]}));
export default r;
