#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_PREFIX=$(mktemp -d)
TARBALL_PATH=""

cleanup() {
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
VERSION_OUTPUT=$(AQM_HOME="$AQM_INSTALL_DIR" "$AQM_BIN" version 2>&1) || VERSION_EXIT=$?
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
# 5. aqm doctor — 프로세스 crash 불합격, FAIL은 허용
# --------------------------------------------------------------------------
echo "[smoke] Testing: aqm doctor..."
DOCTOR_EXIT=0
DOCTOR_OUTPUT=$(AQM_HOME="$AQM_INSTALL_DIR" "$AQM_BIN" doctor 2>&1) || DOCTOR_EXIT=$?

# 128+ = signal-based crash (SIGSEGV=139, SIGABRT=134 등)
if [ "$DOCTOR_EXIT" -ge 128 ]; then
  echo "FAIL: aqm doctor crashed with signal (exit $DOCTOR_EXIT)"
  echo "$DOCTOR_OUTPUT"
  exit 1
fi

if echo "$DOCTOR_OUTPUT" | grep -q "Doctor 완료"; then
  echo "PASS: aqm doctor → Doctor 완료"
else
  # gh/claude CLI 미설치 등 FAIL은 허용
  echo "INFO: aqm doctor completed (exit $DOCTOR_EXIT) — tool failures tolerated in CI"
fi

# --------------------------------------------------------------------------
echo "[smoke] Smoke test passed."
