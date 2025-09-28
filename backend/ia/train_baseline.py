import os, json
import numpy as np, pandas as pd, psycopg2
from sentence_transformers import SentenceTransformer
from datetime import datetime

PG_CONN = os.getenv("DATABASE_URL", "postgresql://USER:PASS@HOST/DB?sslmode=require")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "./models/bert-es-v0-centroids")
EMBEDDER_NAME = os.getenv("EMBEDDER_NAME", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")

os.makedirs(OUTPUT_DIR, exist_ok=True)

def main():
  print("[INFO] Conectando a Postgres…")
  conn = psycopg2.connect(PG_CONN)
  df = pd.read_sql("SELECT id_pregunta, enunciado, id_estandar, dificultad_prior FROM vw_items_entrenamiento", conn)
  conn.close()
  if df.empty: raise SystemExit("No hay datos en vw_items_entrenamiento")

  print(f"[INFO] Ítems: {len(df)} | Estándares: {df['id_estandar'].nunique()}")
  model = SentenceTransformer(EMBEDDER_NAME)
  embs = model.encode(df["enunciado"].tolist(), normalize_embeddings=True, convert_to_numpy=True)

  df["id_estandar"] = df["id_estandar"].astype(str)
  centroids = {}
  for est, idxs in df.groupby("id_estandar").groups.items():
    vecs = embs[list(idxs)]
    centroids[est] = np.mean(vecs, axis=0).tolist()

  meta = {
    "embedder_name": EMBEDDER_NAME,
    "num_items": int(len(df)),
    "num_estandares": int(len(centroids)),
    "trained_at": datetime.utcnow().isoformat() + "Z"
  }
  with open(os.path.join(OUTPUT_DIR, "centroids.json"), "w", encoding="utf-8") as f: json.dump(centroids, f)
  with open(os.path.join(OUTPUT_DIR, "meta.json"), "w", encoding="utf-8") as f: json.dump(meta, f)
  print("[OK] Guardado en", OUTPUT_DIR, meta)

if __name__ == "__main__":
  main()
