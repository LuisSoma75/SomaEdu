import { Router } from "express";
const r = Router();
r.get("/", (req, res) => {
  res.json({ ok: true, data: {
    mastery: 68, classAvg: 61, trend7d: 4,
    byArea: [
      { area: "Números", mastery: 72 },
      { area: "Álgebra", mastery: 59 },
      { area: "Geometría", mastery: 64 },
      { area: "Estadística", mastery: 70 }
    ]
  }});
});
export default r;
