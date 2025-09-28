import { Router } from "express";
const r = Router();
r.get("/", (req, res) => res.json({ ok: true, data: { nombre:"Estudiante", grado:"3ro Básico", seccion:"B" }}));
export default r;
