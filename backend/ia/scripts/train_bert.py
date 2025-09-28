# backend/ia/scripts/train_bert.py
import os, requests

IA_BASE_URL = os.getenv("IA_BASE_URL", "http://127.0.0.1:8000")

def http_retrain():
    url = IA_BASE_URL.rstrip("/") + "/retrain"
    r = requests.post(url, timeout=600)
    print("STATUS:", r.status_code)
    print("CT:", r.headers.get("content-type"))
    print("BODY:", (r.text or "")[:1000])
    r.raise_for_status()
    print("JSON:", r.json())

def inline_retrain():
    # Entrena llamando directamente a la función del servidor (sin HTTP)
    os.environ.setdefault("DATABASE_URL", os.getenv("DATABASE_URL", ""))
    from ia.endpoints.app import retrain
    res = retrain()
    print("INLINE:", res)

if __name__ == "__main__":
    try:
        http_retrain()
    except Exception as e:
        print("HTTP failed -> fallback INLINE. Reason:", e)
        inline_retrain()
