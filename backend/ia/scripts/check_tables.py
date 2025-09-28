# backend/ia/scripts/check_tables.py
import os, pandas as pd
from sqlalchemy import create_engine, text

url = os.getenv("DATABASE_URL")
if not url:
    raise RuntimeError("DATABASE_URL no configurado")

eng = create_engine(url, pool_pre_ping=True)

def find_table_like(base: str) -> str | None:
    # Busca en information_schema respetando el case real
    with eng.connect() as con:
        rows = pd.read_sql(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
            con
        )["table_name"].tolist()
    # coincidencia por case-insensitive
    for name in rows:
        if name.lower() == base.lower():
            return name
    return None

preg_table = find_table_like("pregunta")
resp_table = find_table_like("respuesta")
print("→ Tabla Pregunta:", preg_table)
print("→ Tabla Respuesta:", resp_table)

if preg_table:
    with eng.connect() as con:
        cnt = con.execute(text(f'SELECT COUNT(*) FROM "{preg_table}" WHERE "activa"=TRUE')).scalar()
    print(f'Activas en "{preg_table}":', cnt)
else:
    print("No se encontró tabla Pregunta")

if resp_table:
    with eng.connect() as con:
        cnt_r = con.execute(text(f'SELECT COUNT(*) FROM "{resp_table}"')).scalar()
    print(f'Registros en "{resp_table}":', cnt_r)
else:
    print("No se encontró tabla Respuesta")
