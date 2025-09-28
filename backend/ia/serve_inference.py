import os, json
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import uvicorn

MODEL_DIR = os.getenv("MODEL_DIR", "./models/bert-es-v0-centroids")

with open(os.path.join(MODEL_DIR, "meta.json"), "r", encoding="utf-8") as f:
  META = json.load(f)
with open(os.path.join(MODEL_DIR, "centroids.json"), "r", encoding="utf-8") as f:
  CENTROIDS = {k: np.array(v, dtype=np.float32) for k, v in json.load(f).items()}

EMBEDDER = SentenceTransformer(META["embedder_name"])

app = FastAPI(title="SomaEdu IA - Baseline")

class Item(BaseModel):
  enunciado: str
  topk: int = 1

def cosine_sim(a, b):
  return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

@app.get("/health")
def health():
  return {"ok": True, "estandares": len(CENTROIDS)}

@app.post("/predict/estandar")
def predict_estandar(item: Item):
  vec = EMBEDDER.encode([item.enunciado], normalize_embeddings=True, convert_to_numpy=True)[0]
  sims = []
  for est, cen in CENTROIDS.items():
    sims.append((est, cosine_sim(vec, cen)))
  sims.sort(key=lambda x: x[1], reverse=True)
  topk = max(1, int(item.topk))
  out = [{"id_estandar": est, "similitud": round(sim, 4)} for est, sim in sims[:topk]]
  return {"predicciones": out}

if __name__ == "__main__":
  uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8081")))
