# backend/ia/endpoints/app.py
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Tuple, Dict, Any
from pathlib import Path
import os, numpy as np, joblib, pandas as pd
from sqlalchemy import create_engine, text
from sentence_transformers import SentenceTransformer
from sklearn.linear_model import Ridge
import importlib, uuid

app = FastAPI(title="Adaptive IA")

# =========================
# Config / Artifacts
# =========================
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
ART_DIR = Path(__file__).resolve().parent.parent / "models"
ART_DIR.mkdir(parents=True, exist_ok=True)

_reg = None  # Ridge
_X = None    # embeddings np.ndarray
_df = None   # question_index DataFrame

def load_artifacts():
    """Carga perezosa de los artefactos de entrenamiento."""
    global _reg, _X, _df
    if _reg is None:
        _reg = joblib.load(ART_DIR / "difficulty_reg.pkl")
    if _X is None:
        _X = np.load(ART_DIR / "embeddings.npy")
    if _df is None:
        _df = pd.read_json(ART_DIR / "question_index.json")

# =========================
# Health
# =========================
@app.get("/health")
def health():
    return {"ok": True}

# =========================
# Helpers: tablas / columnas (case-insensitive)
# =========================
def list_tables(con) -> list[str]:
    return pd.read_sql(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
        con
    )["table_name"].tolist()

def list_columns(con, table_name: str) -> list[str]:
    return pd.read_sql(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name = %(t)s",
        con, params={"t": table_name}
    )["column_name"].tolist()

def find_table(con, base: str) -> str | None:
    for n in list_tables(con):
        if n.lower() == base.lower():
            return n
    return None

def find_column(con, table_name: str, base: str) -> str | None:
    for c in list_columns(con, table_name):
        if c.lower() == base.lower():
            return c
    return None

def _scale01(s: pd.Series) -> pd.Series:
    vmin, vmax = s.min(), s.max()
    if pd.isna(vmin) or pd.isna(vmax) or vmax <= vmin:
        return pd.Series([0.5] * len(s), index=s.index)
    return (s - vmin) / (vmax - vmin)

def _engine():
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL no configurado")
    return create_engine(url, pool_pre_ping=True)

# =========================
# Diagnóstico rápido
# =========================
@app.get("/diag")
def diag():
    out = {"ok": True}
    out["cwd"] = os.getcwd()
    out["has_DATABASE_URL"] = bool(os.getenv("DATABASE_URL"))
    out["python_exec"] = os.sys.executable

    def has(mod):
        try:
            m = importlib.import_module(mod)
            return True, getattr(m, "__version__", "n/a")
        except Exception:
            return False, None

    out["torch"] = has("torch")
    out["sentence_transformers"] = has("sentence_transformers")
    out["sklearn"] = has("sklearn")
    out["numpy"] = has("numpy")
    out["pandas"] = has("pandas")
    out["sqlalchemy"] = has("sqlalchemy")
    out["psycopg2"] = has("psycopg2")

    try:
        eng = _engine()
        with eng.connect() as con:
            tabs = list_tables(con)
            out["tables"] = tabs

            preg = find_table(con, "pregunta")
            resp = find_table(con, "respuesta")
            estd = find_table(con, "estandar")
            tema = find_table(con, "tema")
            area = find_table(con, "area")
            out["tables_detected"] = {"pregunta": preg, "respuesta": resp, "estandar": estd, "tema": tema, "area": area}

            cols = {}
            if preg: cols["pregunta"] = list_columns(con, preg)
            if resp: cols["respuesta"] = list_columns(con, resp)
            if estd: cols["estandar"] = list_columns(con, estd)
            if tema: cols["tema"] = list_columns(con, tema)
            if area: cols["area"] = list_columns(con, area)
            out["columns"] = cols

            if preg:
                p_activa = find_column(con, preg, "activa") or "activa"
                out["preguntas_activas"] = int(con.execute(
                    text(f'SELECT COUNT(*) FROM "{preg}" WHERE "{p_activa}"=TRUE')
                ).scalar())
            if resp:
                out["respuestas"] = int(con.execute(text(f'SELECT COUNT(*) FROM "{resp}"')).scalar())
    except Exception as ex:
        out["db_error"] = str(ex)

    return out

# =========================
# Retrain (robusto)
# =========================
@app.post("/retrain")
def retrain():
    try:
        url = os.getenv("DATABASE_URL")
        if not url:
            return {"trained": False, "msg": "DATABASE_URL no configurado", "n_questions": 0}
        engine = create_engine(url, pool_pre_ping=True)

        with engine.connect() as con:
            # Tablas reales
            preg_table = find_table(con, "pregunta")
            resp_table = find_table(con, "respuesta")
            estd_table = find_table(con, "estandar")
            tema_table = find_table(con, "tema")
            area_table = find_table(con, "area")

            if not (preg_table and estd_table and tema_table and area_table):
                faltan = [n for n, v in {
                    "pregunta": preg_table, "estandar": estd_table, "tema": tema_table, "area": area_table
                }.items() if not v]
                return {"trained": False, "msg": f"Faltan tablas: {', '.join(faltan)}", "n_questions": 0}

            # Columnas por tabla
            # Pregunta
            p_id_pregunta = find_column(con, preg_table, "id_pregunta") or "id_pregunta"
            p_enunciado   = find_column(con, preg_table, "enunciado")   or "enunciado"
            p_id_estandar = find_column(con, preg_table, "id_estandar") or "id_estandar"
            p_activa      = find_column(con, preg_table, "activa")      or "activa"

            # Estandar
            e_id_estandar = find_column(con, estd_table, "id_estandar") or "id_estandar"
            e_id_tema     = find_column(con, estd_table, "id_tema")     or "id_tema"
            e_valor       = find_column(con, estd_table, "valor")       or "valor"

            # Tema
            t_id_tema     = find_column(con, tema_table, "id_tema")     or "id_tema"
            t_id_area     = find_column(con, tema_table, "id_area")     or "id_area"

            # Area
            a_id_area     = find_column(con, area_table, "id_area")     or "id_area"
            a_id_materia  = find_column(con, area_table, "id_materia")  or "id_materia"

            # 1) Preguntas activas + valor del estándar + id_materia
            q = f'''
                SELECT
                    p."{p_id_pregunta}" AS id_pregunta,
                    p."{p_enunciado}"   AS enunciado,
                    e."{e_valor}"       AS valor_estandar,
                    a."{a_id_materia}"  AS id_materia
                FROM "{preg_table}" p
                JOIN "{estd_table}" e ON e."{e_id_estandar}" = p."{p_id_estandar}"
                JOIN "{tema_table}" t  ON e."{e_id_tema}"    = t."{t_id_tema}"
                JOIN "{area_table}" a  ON t."{t_id_area}"    = a."{a_id_area}"
                WHERE p."{p_activa}" = TRUE
                ORDER BY p."{p_id_pregunta}"
            '''
            df = pd.read_sql(text(q), con)

        n = int(df.shape[0])
        if n == 0:
            return {"trained": True, "n_questions": 0, "msg": f'No hay preguntas activas en "{preg_table}"'}

        # 2) Embeddings BERT
        mdl = SentenceTransformer(MODEL_NAME)
        X = mdl.encode(df["enunciado"].tolist(), convert_to_numpy=True, normalize_embeddings=True)

        # 3) Objetivo de dificultad con historial si existe:
        acc_map = {}
        if resp_table:
            with engine.connect() as con:
                r_id_preg = find_column(con, resp_table, "id_pregunta") or "id_pregunta"
                r_corr    = find_column(con, resp_table, "correcta")    or "correcta"
                sql_acc = text(
                    f'SELECT "{r_id_preg}", AVG(CASE WHEN "{r_corr}" THEN 1.0 ELSE 0.0 END) AS acc '
                    f'FROM "{resp_table}" GROUP BY "{r_id_preg}"'
                )
                for pid, acc in con.execute(sql_acc):
                    acc_map[int(pid)] = float(acc)

        # normaliza valor por materia
        df["valor_norm"] = df.groupby("id_materia")["valor_estandar"].transform(_scale01)

        y = []
        for pid, vnorm in zip(df["id_pregunta"].tolist(), df["valor_norm"].tolist()):
            acc = acc_map.get(int(pid))  # None si no hay
            if acc is None:
                y.append(0.35 + 0.65 * float(vnorm))  # seed sin historial
            else:
                y.append(0.7 * (1.0 - float(acc)) + 0.3 * float(vnorm))
        y = np.clip(np.array(y, dtype=float), 0.0, 1.0)

        # 4) Regresor simple
        reg = Ridge(alpha=1.0).fit(X, y)

        # 5) Guardar
        joblib.dump(reg, ART_DIR / "difficulty_reg.pkl")
        np.save(ART_DIR / "embeddings.npy", X)
        df[["id_pregunta", "enunciado", "id_materia", "valor_estandar", "valor_norm"]].to_json(
            ART_DIR / "question_index.json",
            orient="records", force_ascii=False
        )

        # limpia el cache en memoria para que /rank cargue lo nuevo
        global _reg, _X, _df
        _reg = _X = _df = None

        return {"trained": True, "n_questions": n, "sin_historial": int(len(acc_map) == 0)}

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        return JSONResponse(
            status_code=500,
            content={"trained": False, "error": str(e), "trace": tb[-2000:]}
        )

# =========================
# Rank: sugiere la(s) siguiente(s) pregunta(s)
# =========================
class RankRequest(BaseModel):
    id_materia: int
    target_valor: float         # valor objetivo del estándar (crudo, como en BD)
    exclude: List[int] = []     # preguntas ya mostradas
    k: int = 1                  # cuántas devolver

def _rank_impl(id_materia: int, target_valor: float, exclude: List[int], k: int = 1):
    load_artifacts()
    if _df is None or _X is None or _reg is None:
        raise RuntimeError("Modelos no entrenados. Ejecuta /retrain primero.")

    df = _df.copy()
    dfm = df[df["id_materia"] == id_materia]
    if dfm.empty:
        return {"target": None, "items": []}

    vmin, vmax = float(dfm["valor_estandar"].min()), float(dfm["valor_estandar"].max())
    if not np.isfinite(vmin) or not np.isfinite(vmax) or vmax <= vmin:
        vnorm = 0.5
    else:
        vnorm = (target_valor - vmin) / (vmax - vmin)
        vnorm = float(np.clip(vnorm, 0.0, 1.0))

    target = 0.35 + 0.65 * vnorm

    preds = _reg.predict(_X)  # alineado con _df
    sub = df.assign(pred=preds)
    sub = sub[sub["id_materia"] == id_materia]

    if exclude:
        sub = sub[~sub["id_pregunta"].isin(exclude)]

    if sub.empty:
        return {"target": target, "items": []}

    sub["gap"] = (sub["pred"] - target).abs()
    sub = sub.sort_values(["gap", "pred", "id_pregunta"]).head(k)

    items = sub[["id_pregunta", "enunciado", "pred", "valor_estandar", "valor_norm"]].to_dict(orient="records")
    for it in items:
        it["id_pregunta"] = int(it["id_pregunta"])
        it["pred"] = float(it["pred"])
        it["valor_estandar"] = float(it["valor_estandar"])
        it["valor_norm"] = float(it["valor_norm"])

    return {"target": target, "items": items}

@app.post("/rank")
def rank(req: RankRequest):
    try:
        out = _rank_impl(req.id_materia, req.target_valor, req.exclude, req.k)
        return out
    except Exception as e:
        import traceback
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": str(e), "trace": traceback.format_exc()[-2000:]}
        )

# =========================
# Carga de opciones de respuesta desde BD
# =========================
def _load_options(con, id_pregunta: int) -> List[Dict[str, Any]]:
    """
    Busca una tabla de opciones/respuestas (p.ej. "Respuesta") y devuelve
    [{id_opcion, texto, correcta?}] si la columna existe.
    """
    # Candidatos por nombre
    t_resp = find_table(con, "respuesta") or find_table(con, "opcion") or find_table(con, "opcion_respuesta")
    if not t_resp:
        # Fallback: encontrar tabla que tenga columna id_pregunta
        for t in list_tables(con):
            cols = [c.lower() for c in list_columns(con, t)]
            if "id_pregunta" in cols:
                t_resp = t
                break

    if not t_resp:
        return []

    col_pid = find_column(con, t_resp, "id_pregunta") or "id_pregunta"
    col_id  = find_column(con, t_resp, "id_respuesta") or find_column(con, t_resp, "id_opcion") or "id_respuesta"
    # texto puede llamarse respuesta/texto/descripcion
    col_txt = find_column(con, t_resp, "respuesta") or find_column(con, t_resp, "texto") or find_column(con, t_resp, "descripcion") or "respuesta"
    col_ok  = find_column(con, t_resp, "correcta")  # puede no existir

    q = text(f'SELECT "{col_id}" AS id, "{col_txt}" AS txt{", " + f\'"{col_ok}" AS ok\' if col_ok else ""} '
             f'FROM "{t_resp}" WHERE "{col_pid}" = :pid ORDER BY 1')
    rows = list(con.execute(q, {"pid": id_pregunta}))
    opts = []
    for r in rows:
        d = dict(r._mapping)
        opts.append({
            "id_opcion": int(d["id"]),
            "texto": str(d["txt"]),
            **({"correcta": bool(d["ok"])} if "ok" in d and d["ok"] is not None else {})
        })
    return opts

# =========================
# Sesiones en memoria
# =========================
SESSIONS: Dict[str, Dict[str, Any]] = {}
# Estructura:
# SESSIONS[sid] = {
#   "carne": str,
#   "id_materia": int,
#   "num_preg_max": int,
#   "exclude": List[int],
#   "shown": int,
#   "last_target": float
# }

class StartBody(BaseModel):
    carne_estudiante: str | int
    id_materia: int
    num_preg_max: int

class AnswerBody(BaseModel):
    id_pregunta: int
    id_opcion: int
    id_materia: int
    valor_estandar_actual: float

def _initial_target_for_materia(id_materia: int) -> float:
    """Usa el rango real de 'valor_estandar' para elegir un target medio crudo."""
    load_artifacts()
    dfm = _df[_df["id_materia"] == id_materia]
    if dfm.empty:
        return 0.5
    vmin, vmax = float(dfm["valor_estandar"].min()), float(dfm["valor_estandar"].max())
    if not np.isfinite(vmin) or not np.isfinite(vmax) or vmax <= vmin:
        return 0.5
    return 0.5 * (vmin + vmax)

def _question_payload(pid: int, enunciado: str, id_materia: int) -> Dict[str, Any]:
    """Adjunta opciones desde BD y normaliza payload."""
    try:
        eng = _engine()
        with eng.connect() as con:
            opciones = _load_options(con, pid)
    except Exception:
        opciones = []
    return {
        "id_pregunta": int(pid),
        "enunciado": enunciado,
        "opciones": opciones,
    }

# =========================
# Endpoints de sesión adaptativa
# =========================
@app.post("/session/start")
def session_start(body: StartBody):
    """
    Inicia sesión adaptativa y devuelve la primera pregunta.
    """
    try:
        sid = uuid.uuid4().hex  # si tu Node ya tiene id_evaluacion, puedes reemplazarlo por ese
        target = _initial_target_for_materia(body.id_materia)

        # Elige 1ra pregunta
        out = _rank_impl(body.id_materia, target, exclude=[], k=1)
        items = out.get("items", [])
        if not items:
            return {"ok": True, "session_id": sid, "question": None, "msg": "Sin preguntas disponibles para la materia."}

        q = items[0]
        payload = _question_payload(q["id_pregunta"], q["enunciado"], body.id_materia)

        # Guarda sesión
        SESSIONS[sid] = {
            "carne": str(body.carne_estudiante),
            "id_materia": int(body.id_materia),
            "num_preg_max": int(body.num_preg_max),
            "exclude": [int(q["id_pregunta"])],
            "shown": 1,
            "last_target": float(q["valor_estandar"]),  # o usa 'out["target"]'
        }

        return {"ok": True, "session_id": sid, "question": payload}
    except Exception as e:
        import traceback
        return JSONResponse(status_code=500, content={"ok": False, "msg": str(e), "trace": traceback.format_exc()[-2000:]})

@app.get("/session/{sid}/next")
def session_next(sid: str, student_id: Optional[str | int] = Query(None, alias="student_id")):
    """
    Devuelve la siguiente pregunta (sin registrar respuesta).
    Útil si tu frontend prefiere preguntar explícitamente por NEXT.
    """
    try:
        sess = SESSIONS.get(sid)
        if not sess:
            return JSONResponse(status_code=404, content={"ok": False, "msg": "Sesión no encontrada"})

        if sess["shown"] >= sess["num_preg_max"]:
            return {"ok": True, "question": None, "finished": True}

        out = _rank_impl(sess["id_materia"], sess["last_target"], exclude=sess["exclude"], k=1)
        items = out.get("items", [])
        if not items:
            return {"ok": True, "question": None, "finished": True}

        q = items[0]
        payload = _question_payload(q["id_pregunta"], q["enunciado"], sess["id_materia"])

        sess["exclude"].append(int(q["id_pregunta"]))
        sess["shown"] += 1
        sess["last_target"] = float(q["valor_estandar"])

        return {"ok": True, "question": payload}
    except Exception as e:
        import traceback
        return JSONResponse(status_code=500, content={"ok": False, "msg": str(e), "trace": traceback.format_exc()[-2000:]})

@app.post("/session/{sid}/answer")
def session_answer(sid: str, body: AnswerBody):
    """
    Registra la respuesta y devuelve la siguiente pregunta (o fin).
    """
    try:
        sess = SESSIONS.get(sid)
        if not sess:
            # Sesión no encontrada: crea una provisional basada en id_materia
            SESSIONS[sid] = sess = {
                "carne": None,
                "id_materia": int(body.id_materia),
                "num_preg_max": 999,
                "exclude": [],
                "shown": 0,
                "last_target": float(body.valor_estandar_actual),
            }

        # Actualiza estado
        if body.id_pregunta not in sess["exclude"]:
            sess["exclude"].append(int(body.id_pregunta))
        sess["last_target"] = float(body.valor_estandar_actual)

        # Límite de preguntas
        if sess["shown"] >= sess["num_preg_max"]:
            return {"ok": True, "question": None, "finished": True}

        # Calcula siguiente
        out = _rank_impl(sess["id_materia"], sess["last_target"], exclude=sess["exclude"], k=1)
        items = out.get("items", [])
        if not items:
            return {"ok": True, "question": None, "finished": True}

        q = items[0]
        payload = _question_payload(q["id_pregunta"], q["enunciado"], sess["id_materia"])

        sess["exclude"].append(int(q["id_pregunta"]))
        sess["shown"] += 1
        sess["last_target"] = float(q["valor_estandar"])

        return {"ok": True, "question": payload}
    except Exception as e:
        import traceback
        return JSONResponse(status_code=500, content={"ok": False, "msg": str(e), "trace": traceback.format_exc()[-2000:]})

@app.post("/session/{sid}/end")
def session_end(sid: str):
    """
    Finaliza manualmente una sesión adaptativa.
    """
    try:
        if sid in SESSIONS:
            del SESSIONS[sid]
        return {"ok": True, "ended": True}
    except Exception as e:
        import traceback
        return JSONResponse(status_code=500, content={"ok": False, "msg": str(e), "trace": traceback.format_exc()[-2000:]})
