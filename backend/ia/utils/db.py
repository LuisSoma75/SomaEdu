# ia/utils/db.py
import os
from sqlalchemy import create_engine

def get_engine():
    url = os.getenv("postgresql://neondb_owner:npg_eGnlz5RXx8su@ep-little-sunset-aedq2uy0-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require")
    if not url:
        raise RuntimeError("DATABASE_URL no configurado")
    return create_engine(url, pool_pre_ping=True)
