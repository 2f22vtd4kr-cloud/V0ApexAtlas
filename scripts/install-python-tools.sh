#!/usr/bin/env bash
# Install Python OSINT tools for ApexFinder Pro
# Run once after import; safe to re-run (idempotent).
#
# Replit's system Python is immutable. Keep the tools in the workspace-local
# uv environment so the API and the installer use the same interpreter.

set -e

echo "=== ApexFinder Python OSINT Tools Setup ==="
PYTHON_BIN="${APEX_PYTHON_BIN:-}"
if [ -z "$PYTHON_BIN" ] && [ -x "$PWD/.pythonlibs/bin/python3" ]; then
  PYTHON_BIN="$PWD/.pythonlibs/bin/python3"
fi
if [ -z "$PYTHON_BIN" ] && command -v uv >/dev/null 2>&1; then
  echo "Creating workspace-local Python environment at .pythonlibs..."
  uv venv "$PWD/.pythonlibs" --python "$(command -v python3)"
  PYTHON_BIN="$PWD/.pythonlibs/bin/python3"
fi
if [ -z "$PYTHON_BIN" ]; then
  PYTHON_BIN="$(command -v python3)"
fi

"$PYTHON_BIN" --version
echo ""

install_package() {
  if command -v uv >/dev/null 2>&1; then
    if [ ! -x "$PWD/.pythonlibs/bin/python3" ]; then
      uv venv "$PWD/.pythonlibs" --python "$(command -v python3)"
      PYTHON_BIN="$PWD/.pythonlibs/bin/python3"
    fi
    uv pip install --python "$PYTHON_BIN" "$1"
  else
    "$PYTHON_BIN" -m pip install --disable-pip-version-check -q "$1"
  fi
}

# ── Holehe: email → 120+ platform presence checks ────────────────────────────
echo "[1/3] Installing holehe..."
install_package holehe && echo "  ✓ holehe installed" || echo "  ✗ holehe failed (non-fatal)"

# ── Maigret: username → 3000+ site dossier ───────────────────────────────────
echo "[2/3] Installing maigret..."
install_package maigret && echo "  ✓ maigret installed" || echo "  ✗ maigret failed (non-fatal)"

# ── Sherlock: supplementary username discovery ────────────────────────────────
echo "[3/4] Installing sherlock-project..."
install_package sherlock-project && echo "  ✓ sherlock installed" || echo "  ✗ sherlock failed (non-fatal)"

# ── Open Deep Research — optional Hugging Face agent + Serper browser ─────────
echo "[4/5] Open Deep Research — optional (smolagents + browser adapter)"
install_package "smolagents>=1.21.0" && echo "  ✓ smolagents installed" || echo "  ✗ smolagents failed (optional)"
install_package "beautifulsoup4>=4.12.0" && echo "  ✓ beautifulsoup4 installed" || echo "  ✗ beautifulsoup4 failed (optional)"
install_package "markdownify>=0.14.0" && echo "  ✓ markdownify installed" || echo "  ✗ markdownify failed (optional)"
install_package "python-dotenv>=1.0.0" && echo "  ✓ python-dotenv installed" || echo "  ✗ python-dotenv failed (optional)"
install_package "requests>=2.32.0" && echo "  ✓ requests installed" || echo "  ✗ requests failed (optional)"

# ── theHarvester requires Python ≥3.12 ───────────────────────────────────────
echo "[5/5] theHarvester — optional (requires Python ≥3.12 and upstream package)"
echo "      Current interpreter: $("$PYTHON_BIN" --version 2>&1)"

echo ""
echo "=== Tool availability ==="
"$PYTHON_BIN" -c "import holehe; print('  holehe:       ✓')" 2>/dev/null || echo "  holehe:       ✗"
"$PYTHON_BIN" -c "import maigret; print('  maigret:      ✓')" 2>/dev/null || echo "  maigret:      ✗"
"$PYTHON_BIN" -c "import sherlock_project; print('  sherlock:     ✓')" 2>/dev/null || echo "  sherlock:     ✗"
"$PYTHON_BIN" -c "import smolagents; print('  smolagents:   ✓')" 2>/dev/null || echo "  smolagents:   ✗ (optional)"
"$PYTHON_BIN" -c "import bs4, markdownify, requests; print('  research web: ✓')" 2>/dev/null || echo "  research web: ✗ (optional)"
"$PYTHON_BIN" -c "import gliner;  print('  gliner:       ✓')" 2>/dev/null || echo "  gliner:       ✗ (optional — heavy deps)"

echo ""
echo "=== Done ==="
echo "Run 'python3 scripts/gliner_service.py' to start the GLiNER NER microservice on port 7890."
