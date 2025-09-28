# ia/utils/features.py
import os, json
import numpy as np
import pandas as pd
from sqlalchemy import text
from sentence_transformers import SentenceTransformer
from sklearn.linear_model import Ridge

_model_cache = None

def get_sentence_model():
    global _model_cache
    if _model_cache is None:
        # Modelo multilingüe liviano
        _model_cache = SentenceTransformer("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
    return _model_cache

def embed_texts(model, texts):
    vecs = model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
    return np.array(vecs)

def load_or_fit_regressor(X, y):
    # Ridge sencillo; puedes cambiar a otra regresión
    reg = Ridge(alpha=1.0)
    reg.fit(X, y)
    return reg

def fetch_question_texts(engine):
    sql = """
      SELECT p.id_pregunta, p.enunciado
      FROM PREGUNTA p
      WHERE p.activa = TRUE
      ORDER BY p.id_pregunta
    """
    with engine.connect() as con:
      df = pd.read_sql(sql, con)
    return df

def fetch_questions_by_estandar(engine, id_estandar:int):
    sql = """
      SELECT p.id_pregunta, p.enunciado
      FROM PREGUNTA p
      WHERE p.activa = TRUE AND p.id_estandar = :e
      ORDER BY p.id_pregunta
    """
    with engine.connect() as con:
      df = pd.read_sql(text(sql), con, params={"e": id_estandar})
    return df

def fetch_unseen_questions(engine, id_evaluacion:int, ids:list[int]):
    if not ids:
        return pd.DataFrame(columns=["id_pregunta"])
    sql = """
      SELECT q.id_pregunta
      FROM (SELECT UNNEST(:ids)::int AS id_pregunta) q
      WHERE q.id_pregunta NOT IN (
        SELECT id_pregunta FROM DETALLE_EVALUACION WHERE id_evaluacion = :ev
      )
    """
    # SQLAlchemy no pasa arreglos anónimos fácil a UNNEST en algunos drivers; hacemos alternativa:
    ids_tuple = tuple(int(x) for x in ids)
    q = f"""
      SELECT p.id_pregunta
      FROM PREGUNTA p
      WHERE p.id_pregunta IN {ids_tuple if len(ids_tuple)>1 else f"({ids_tuple[0]})"}
        AND p.id_pregunta NOT IN (
          SELECT id_pregunta FROM DETALLE_EVALUACION WHERE id_evaluacion = {int(id_evaluacion)}
        )
      ORDER BY p.id_pregunta
    """
    with engine.connect() as con:
      df = pd.read_sql(q, con)
    return df

def standard_value_range(engine, id_estandar:int):
    # rango de valores dentro de la misma materia (o todo el universo)
    sql = """
      SELECT e.valor
      FROM ESTANDAR e
      JOIN TEMA t ON e.id_tema = t.id_tema
      JOIN AREA a ON t.id_area = a.id_area
      WHERE a.id_materia = (
        SELECT a2.id_materia
        FROM ESTANDAR e2
        JOIN TEMA t2 ON e2.id_tema = t2.id_tema
        JOIN AREA a2 ON t2.id_area = a2.id_area
        WHERE e2.id_estandar = :e
      )
    """
    with engine.connect() as con:
      vals = [r[0] for r in con.execute(text(sql), {"e": id_estandar})]
    if not vals:
        return (0.0, 1.0)
    return (min(vals), max(vals))

def scale_to_unit(v, vmin, vmax):
    if vmax <= vmin: return 0.5
    return (float(v) - float(vmin)) / (float(vmax) - float(vmin))
