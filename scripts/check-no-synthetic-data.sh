#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# ApexFinder Pro — Synthetic Data Guard
#
# Fails if any banned pattern is found in source files.
# Run: bash scripts/check-no-synthetic-data.sh
# Wired into: post-merge, CI, and Replit validation.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ERRORS=0

# Directories to scan (excludes node_modules, dist, .replit-artifact automatically)
SRC_DIRS=(
  "artifacts/api-server/src"
  "artifacts/apex-finder/src"
  "artifacts/apex-mobile/src"
  "lib"
  "scripts"
)

# Files excluded from Math.random() check (legitimate algorithmic uses)
MATH_RANDOM_ALLOWLIST=(
  "lib/mcts-agent.ts"               # Monte Carlo algorithm — uses RNG by definition
  "artifacts/api-server/src/lib/mcts-agent.ts"
)

echo "╔══════════════════════════════════════════════════════╗"
echo "║  ApexFinder Synthetic Data Guard                     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Banned libraries ───────────────────────────────────────────────────────
echo "▸ Checking for banned data-generation libraries..."
BANNED_LIBS=("faker" "@faker-js" "chance" "casual" "randexp" "generate-password" "lorem-ipsum")

for dir in "${SRC_DIRS[@]}"; do
  [[ -d "$dir" ]] || continue
  for lib in "${BANNED_LIBS[@]}"; do
    matches=$(grep -rn --include="*.ts" --include="*.tsx" --include="*.js" \
      "from ['\"]${lib}" "$dir" 2>/dev/null || true)
    if [[ -n "$matches" ]]; then
      echo "  ✗ BANNED LIBRARY '${lib}' imported:"
      echo "$matches" | sed 's/^/    /'
      ERRORS=$((ERRORS + 1))
    fi
  done
done

# Also check package.json files for banned deps
for pkg in $(find . -name "package.json" -not -path "*/node_modules/*" -not -path "*/.replit-artifact/*"); do
  for lib in "${BANNED_LIBS[@]}"; do
    if grep -q "\"${lib}\"" "$pkg" 2>/dev/null; then
      echo "  ✗ BANNED LIBRARY '${lib}' found in ${pkg}"
      ERRORS=$((ERRORS + 1))
    fi
  done
done

# ── 2. Math.random() outside allowlist ───────────────────────────────────────
echo "▸ Checking for Math.random() outside algorithmic allowlist..."

for dir in "${SRC_DIRS[@]}"; do
  [[ -d "$dir" ]] || continue
  while IFS= read -r -d '' file; do
    # Skip test files
    [[ "$file" == *".test.ts"* ]] && continue
    [[ "$file" == *".test.tsx"* ]] && continue
    [[ "$file" == *".spec.ts"* ]] && continue
    [[ "$file" == *"__tests__"* ]] && continue

    # Skip allowlisted files
    skip=0
    for allowed in "${MATH_RANDOM_ALLOWLIST[@]}"; do
      if [[ "$file" == *"$allowed"* ]]; then
        skip=1
        break
      fi
    done
    [[ $skip -eq 1 ]] && continue

    matches=$(grep -n "Math\.random()" "$file" 2>/dev/null || true)
    if [[ -n "$matches" ]]; then
      echo "  ✗ Math.random() in ${file}:"
      echo "$matches" | sed 's/^/    /'
      ERRORS=$((ERRORS + 1))
    fi
  done < <(find "$dir" -type f \( -name "*.ts" -o -name "*.tsx" \) -print0)
done

# ── 3. Hardcoded synthetic content patterns ───────────────────────────────────
echo "▸ Checking for hardcoded synthetic content..."

# Patterns that indicate synthetic/placeholder data returned to the user
SYNTHETIC_PATTERNS=(
  'lorem ipsum'
  'John Doe'
  'Jane Doe'
  'test@example\.com'
  'foo@bar\.com'
  'placeholder data'
  'TODO.*fake'
  'TODO.*mock'
  'FIXME.*fake'
  'FIXME.*mock'
)

for dir in "artifacts/api-server/src" "lib"; do
  [[ -d "$dir" ]] || continue
  for pattern in "${SYNTHETIC_PATTERNS[@]}"; do
    matches=$(grep -rni --include="*.ts" "$pattern" "$dir" 2>/dev/null | \
      grep -v "\.test\.\|spec\.\|__tests__\|/\*\|^\s*//" || true)
    if [[ -n "$matches" ]]; then
      echo "  ✗ Synthetic pattern '${pattern}':"
      echo "$matches" | sed 's/^/    /'
      ERRORS=$((ERRORS + 1))
    fi
  done
done

# ── 4. Seeding / data-generation functions in API routes ─────────────────────
echo "▸ Checking for seeding/generation functions in API routes..."

SEED_PATTERNS=(
  'seedDatabase'
  'insertMockData'
  'insertFakeData'
  'generateFake'
  'createDummyData'
  'populateWithMock'
)

for dir in "artifacts/api-server/src/routes"; do
  [[ -d "$dir" ]] || continue
  for pattern in "${SEED_PATTERNS[@]}"; do
    matches=$(grep -rn --include="*.ts" "$pattern" "$dir" 2>/dev/null || true)
    if [[ -n "$matches" ]]; then
      echo "  ✗ Seed/generation function '${pattern}':"
      echo "$matches" | sed 's/^/    /'
      ERRORS=$((ERRORS + 1))
    fi
  done
done

# ── Result ────────────────────────────────────────────────────────────────────
echo ""
if [[ $ERRORS -eq 0 ]]; then
  echo "✓ All checks passed — no synthetic data patterns found."
  exit 0
else
  echo "✗ ${ERRORS} synthetic data violation(s) found."
  echo "  Fix all violations before merging. No synthetic/fake/random data"
  echo "  may be generated or returned anywhere outside the MCTS algorithm."
  exit 1
fi
