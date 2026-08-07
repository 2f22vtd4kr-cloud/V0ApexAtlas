#!/usr/bin/env python3
"""
GLiNER NER Microservice
Runs a lightweight HTTP server on port 7890 that exposes:
  POST /extract  { text, labels, threshold } -> { entities, model }
  GET  /health   -> { status: "ok" }
  GET  /status   -> { model_loaded, model, memory_mb }

Model priority:
  1. urchade/gliner-multi-v2.1  (default, ~400MB, good accuracy)
  2. urchade/gliner-small-v2.1  (fallback, ~100MB, faster)

Usage:
  python3 scripts/gliner_service.py [--port 7890] [--model urchade/gliner-multi-v2.1]

The service loads the model once on startup (lazy: first request triggers load).
Subsequent requests are fast (~20-50ms per 500 tokens).
"""

import json
import os
import sys
import time
import threading
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

PORT = int(os.environ.get("GLINER_PORT", 7890))
DEFAULT_MODEL = os.environ.get("GLINER_MODEL", "urchade/gliner-multi-v2.1")
FALLBACK_MODEL = "urchade/gliner-small-v2.1"

model = None
model_name = None
model_loaded = False
model_loading = False
model_lock = threading.Lock()
load_error = None


def load_model():
    global model, model_name, model_loaded, model_loading, load_error
    with model_lock:
        if model_loaded or model_loading:
            return
        model_loading = True

    try:
        from gliner import GLiNER
        print(f"[GLiNER] Loading model {DEFAULT_MODEL}...", flush=True)
        start = time.time()
        try:
            m = GLiNER.from_pretrained(DEFAULT_MODEL)
            mn = DEFAULT_MODEL
        except Exception as e:
            print(f"[GLiNER] Primary model failed ({e}), trying fallback {FALLBACK_MODEL}...", flush=True)
            m = GLiNER.from_pretrained(FALLBACK_MODEL)
            mn = FALLBACK_MODEL
        elapsed = time.time() - start
        with model_lock:
            model = m
            model_name = mn
            model_loaded = True
            model_loading = False
        print(f"[GLiNER] Model {mn} loaded in {elapsed:.1f}s", flush=True)
    except ImportError:
        with model_lock:
            model_loading = False
            load_error = "gliner package not installed — run: pip install gliner"
        print(f"[GLiNER] ERROR: {load_error}", flush=True)
    except Exception as e:
        with model_lock:
            model_loading = False
            load_error = str(e)
        print(f"[GLiNER] ERROR loading model: {e}", flush=True)
        traceback.print_exc()


def extract_entities(text, labels, threshold=0.5):
    """Run GLiNER NER on text with the given entity type labels."""
    if not model_loaded or model is None:
        return []
    # GLiNER expects: model.predict_entities(text, labels, threshold=X)
    try:
        entities = model.predict_entities(text, labels, threshold=threshold)
        return [
            {
                "text": e["text"],
                "label": e["label"],
                "score": round(float(e["score"]), 4),
                "start": e["start"],
                "end": e["end"],
            }
            for e in entities
        ]
    except Exception as e:
        print(f"[GLiNER] predict error: {e}", flush=True)
        return []


def get_memory_mb():
    try:
        import psutil
        proc = psutil.Process(os.getpid())
        return round(proc.memory_info().rss / 1024 / 1024, 1)
    except Exception:
        return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress default HTTP logs

    def send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self.send_json(200, {"status": "ok", "model_loaded": model_loaded})
        elif path == "/status":
            self.send_json(200, {
                "status": "ok",
                "model_loaded": model_loaded,
                "model_loading": model_loading,
                "model": model_name,
                "memory_mb": get_memory_mb(),
                "error": load_error,
            })
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/extract":
            self.send_json(404, {"error": "not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            req = json.loads(body)
        except Exception as e:
            self.send_json(400, {"error": f"invalid JSON: {e}"})
            return

        text = req.get("text", "")
        labels = req.get("labels", ["person name", "company name", "job title", "location"])
        threshold = float(req.get("threshold", 0.5))

        if not text:
            self.send_json(400, {"error": "text is required"})
            return

        # Trigger lazy load if not yet loaded
        if not model_loaded and not model_loading:
            threading.Thread(target=load_model, daemon=True).start()
            # Wait up to 5s for the model to start loading
            for _ in range(50):
                time.sleep(0.1)
                if model_loaded or load_error:
                    break

        if not model_loaded:
            if load_error:
                self.send_json(503, {"error": load_error, "entities": [], "service_available": False})
            else:
                self.send_json(503, {"error": "model still loading, retry shortly", "entities": [], "service_available": False})
            return

        start = time.time()
        entities = extract_entities(text, labels, threshold)
        elapsed_ms = round((time.time() - start) * 1000, 1)

        self.send_json(200, {
            "entities": entities,
            "count": len(entities),
            "model": model_name,
            "elapsed_ms": elapsed_ms,
        })


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--eager", action="store_true", help="Load model immediately on start")
    args = parser.parse_args()

    PORT = args.port
    DEFAULT_MODEL = args.model

    print(f"[GLiNER] Starting server on port {PORT}", flush=True)
    print(f"[GLiNER] Model: {DEFAULT_MODEL} (lazy load on first request)", flush=True)
    print(f"[GLiNER] Endpoints: POST /extract  GET /health  GET /status", flush=True)

    if args.eager:
        threading.Thread(target=load_model, daemon=True).start()

    server = HTTPServer(("127.0.0.1", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[GLiNER] Shutting down", flush=True)
