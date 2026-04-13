#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_PREFIX=$(mktemp -d)
TARBALL_PATH=""
SMOKE_PORT=$(( 49152 + RANDOM % 11848 ))
SMOKE_PID=""

cleanup() {
  if [ -n "${SMOKE_PID:-}" ] && kill -0 "$SMOKE_PID" 2>/dev/null; then
    kill "$SMOKE_PID" 2>/dev/null || true
    wait "$SMOKE_PID" 2>/dev/null || true
  fi
  fuser -k "${SMOKE_PORT}/tcp" 2>/dev/null || true
  if [ -n "$TARBALL_PATH" ] && [ -f "$TARBALL_PATH" ]; then
    rm -f "$TARBALL_PATH"
  fi
  rm -rf "$TMP_PREFIX"
}
trap cleanup EXIT

cd "$PROJECT_ROOT"

# --------------------------------------------------------------------------
# 1. Build
# --------------------------------------------------------------------------
echo "[smoke] Building dist/..."
npm run build

# --------------------------------------------------------------------------
# 2. Pack
# --------------------------------------------------------------------------
echo "[smoke] Running npm pack..."
TARBALL_NAME=$(npm pack 2>/dev/null | tail -1)
TARBALL_PATH="$PROJECT_ROOT/$TARBALL_NAME"

if [ ! -f "$TARBALL_PATH" ]; then
  echo "FAIL: tarball not found: $TARBALL_PATH"
  exit 1
fi
echo "[smoke] Tarball: $TARBALL_NAME"

# --------------------------------------------------------------------------
# 3. Global install to temp prefix
# --------------------------------------------------------------------------
echo "[smoke] Installing to $TMP_PREFIX..."
npm install -g "$TARBALL_PATH" --prefix "$TMP_PREFIX" --silent 2>/dev/null

AQM_INSTALL_DIR="$TMP_PREFIX/lib/node_modules/ai-quartermaster"
AQM_BIN="$TMP_PREFIX/bin/aqm"

if [ ! -f "$AQM_BIN" ]; then
  echo "FAIL: aqm binary not found at $AQM_BIN"
  exit 1
fi

# --------------------------------------------------------------------------
# 4. aqm version — exit 0 + 버전 문자열
# --------------------------------------------------------------------------
echo "[smoke] Testing: aqm version..."
VERSION_OUTPUT=$("$AQM_BIN" version 2>&1) || VERSION_EXIT=$?
VERSION_EXIT=${VERSION_EXIT:-0}

if [ "$VERSION_EXIT" -ne 0 ]; then
  echo "FAIL: aqm version exited $VERSION_EXIT"
  echo "$VERSION_OUTPUT"
  exit 1
fi

if ! echo "$VERSION_OUTPUT" | grep -qE "v[0-9]+\.[0-9]+\.[0-9]+"; then
  echo "FAIL: aqm version output missing version string"
  echo "$VERSION_OUTPUT"
  exit 1
fi

echo "PASS: aqm version → $VERSION_OUTPUT"

# --------------------------------------------------------------------------
# 5. aqm doctor — exit 0 필수 (FAIL은 더 이상 허용하지 않음)
# --------------------------------------------------------------------------
echo "[smoke] Testing: aqm doctor..."
DOCTOR_EXIT=0
DOCTOR_OUTPUT=$("$AQM_BIN" doctor 2>&1) || DOCTOR_EXIT=$?

if [ "$DOCTOR_EXIT" -ne 0 ]; then
  echo "FAIL: aqm doctor exited $DOCTOR_EXIT"
  echo "$DOCTOR_OUTPUT"
  exit 1
fi

echo "PASS: aqm doctor → exit 0"

# --------------------------------------------------------------------------
# 6. aqm start + /health 200 확인
# --------------------------------------------------------------------------
echo "[smoke] Testing: aqm start (port $SMOKE_PORT)..."

SMOKE_HOME="$TMP_PREFIX/aqm-home"
SMOKE_REPO="$TMP_PREFIX/smoke-repo"
mkdir -p "$SMOKE_HOME" "$SMOKE_REPO"

cat > "$SMOKE_HOME/config.yml" << EOF
general:
  serverMode: "polling"
  logLevel: "warn"
projects:
  - repo: "smoke/repo"
    path: "$SMOKE_REPO"
    baseBranch: "main"
EOF

"$AQM_BIN" start --config "$SMOKE_HOME/config.yml" --port "$SMOKE_PORT" --mode polling &
SMOKE_PID=$!

HEALTH_PASS=0
for i in $(seq 1 15); do
  HEALTH_RESPONSE=$(curl -sf "http://127.0.0.1:$SMOKE_PORT/health" 2>/dev/null) || true
  if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    HEALTH_PASS=1
    break
  fi
  sleep 1
done

if [ "$HEALTH_PASS" -ne 1 ]; then
  echo "FAIL: aqm start /health did not respond within 15s"
  exit 1
fi

echo "PASS: aqm start → /health returned {\"status\":\"ok\"}"

# --------------------------------------------------------------------------
# 7. 회귀 감지 — dist/ 제거 후 기동 실패 확인
# --------------------------------------------------------------------------
echo "[smoke] Testing: regression gate (dist/ 제거 후 기동 실패)..."

kill "$SMOKE_PID" 2>/dev/null || true
wait "$SMOKE_PID" 2>/dev/null || true
SMOKE_PID=""

rm -rf "$AQM_INSTALL_DIR/dist"

REGRESSION_PORT=$(( SMOKE_PORT + 1 ))
"$AQM_BIN" start --config "$SMOKE_HOME/config.yml" --port "$REGRESSION_PORT" --mode polling &
SMOKE_PID=$!

REGRESSION_HEALTH=0
for i in $(seq 1 10); do
  if curl -sf "http://127.0.0.1:$REGRESSION_PORT/health" 2>/dev/null | grep -q '"status":"ok"'; then
    REGRESSION_HEALTH=1
    break
  fi
  sleep 1
done

kill "$SMOKE_PID" 2>/dev/null || true
wait "$SMOKE_PID" 2>/dev/null || true
SMOKE_PID=""

if [ "$REGRESSION_HEALTH" -eq 1 ]; then
  echo "FAIL: regression gate broken — aqm start succeeded without dist/"
  exit 1
fi

echo "PASS: regression gate — aqm start fails without dist/"

# --------------------------------------------------------------------------
# 6. git-clone 모드 테스트 — AQM_HOME을 프로젝트 루트로 설정
# --------------------------------------------------------------------------
echo "[smoke] Testing: git-clone mode (AQM_HOME=$PROJECT_ROOT)..."
GIT_VERSION_OUTPUT=$(AQM_HOME="$PROJECT_ROOT" "$AQM_BIN" version 2>&1) || GIT_VERSION_EXIT=$?
GIT_VERSION_EXIT=${GIT_VERSION_EXIT:-0}

if [ "$GIT_VERSION_EXIT" -ne 0 ]; then
  echo "FAIL: aqm version (git-clone mode) exited $GIT_VERSION_EXIT"
  echo "$GIT_VERSION_OUTPUT"
  exit 1
fi

if ! echo "$GIT_VERSION_OUTPUT" | grep -qE "v[0-9]+\.[0-9]+\.[0-9]+"; then
  echo "FAIL: aqm version (git-clone mode) output missing version string"
  echo "$GIT_VERSION_OUTPUT"
  exit 1
fi

echo "PASS: aqm version (git-clone mode) → $GIT_VERSION_OUTPUT"

# --------------------------------------------------------------------------
echo "[smoke] Smoke test passed."
