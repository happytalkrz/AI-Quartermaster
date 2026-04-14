#!/usr/bin/env bash
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

AQM_HOME="${AQM_HOME:-$HOME/.ai-quartermaster}"
BIN_DIR="${HOME}/.local/bin"
REPO_URL="https://github.com/happytalkrz/AI-Quartermaster.git"

echo -e "${BLUE}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║   AI Quartermaster 설치               ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# 1. Check prerequisites
echo -e "${YELLOW}1. 사전 요구사항 확인...${NC}"

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo -e "  ${RED}✗ $1 — $2${NC}"
    exit 1
  fi
  echo -e "  ${GREEN}✓ $1${NC}"
}

check_cmd "git" "https://git-scm.com 에서 설치하세요"
check_cmd "node" "https://nodejs.org 에서 Node.js 20+ 설치하세요"
check_cmd "npm" "Node.js 설치 시 함께 설치됩니다"
check_cmd "gh" "https://cli.github.com 에서 설치 후 gh auth login 하세요"
check_cmd "claude" "https://docs.anthropic.com/en/docs/claude-code 에서 설치하세요"

# Native build tools preflight (warning only — prebuilt binary로 충분할 수 있음)
echo ""
echo -e "${YELLOW}  [native build tools 확인]${NC}"
NATIVE_WARN=0
for tool in python3 make g++; do
  if ! command -v "$tool" &>/dev/null; then
    echo -e "  ${YELLOW}⚠ $tool 없음 — prebuilt binary 없을 경우 better-sqlite3 소스 빌드 실패 가능${NC}"
    NATIVE_WARN=1
  else
    echo -e "  ${GREEN}✓ $tool${NC}"
  fi
done
if [ "$NATIVE_WARN" -eq 1 ]; then
  echo -e "  ${YELLOW}→ 소스 빌드가 필요한 환경(Alpine Linux, 구버전 macOS arm64 등)에서는"
  echo -e "    python3, make, g++ 설치 후 다시 시도하세요${NC}"
fi

# Print claude version
CLAUDE_VERSION=$(claude --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [ -n "$CLAUDE_VERSION" ]; then
  echo -e "  ${GREEN}  claude 버전: v${CLAUDE_VERSION}${NC}"
fi
echo ""

# better-sqlite3 로드 검증 함수
verify_better_sqlite3() {
  echo -e "${YELLOW}  [better-sqlite3 로드 검증]${NC}"
  if node -e "require('better-sqlite3')" 2>/dev/null; then
    echo -e "  ${GREEN}✓ better-sqlite3 정상 로드${NC}"
  else
    echo -e "  ${RED}✗ better-sqlite3 로드 실패${NC}"
    echo ""
    echo -e "  ${YELLOW}── 진단 정보 ──${NC}"
    echo -e "  Node.js 버전: $(node -v 2>&1)"
    echo -e "  시스템: $(uname -a 2>&1)"
    echo -e "  패키지 상태:"
    npm ls better-sqlite3 2>&1 | sed 's/^/    /'
    echo ""
    echo -e "  ${YELLOW}해결 방법:${NC}"
    echo -e "  1. python3, make, g++ 설치 후 npm rebuild better-sqlite3 실행"
    echo -e "  2. 문제가 지속되면 위 진단 정보와 함께 이슈를 제보하세요:"
    echo -e "     https://github.com/happytalkrz/AI-Quartermaster/issues"
    exit 1
  fi
}

# 2. Install or update
NPM_LOG=$(mktemp /tmp/aqm-install-XXXXXX.log)

if [ -d "$AQM_HOME" ]; then
  echo -e "${YELLOW}2. 기존 설치 업데이트...${NC}"
  cd "$AQM_HOME"
  git pull --quiet
  npm install --silent 2>"$NPM_LOG" || {
    echo -e "  ${RED}✗ npm install 실패${NC}"
    echo -e "  ${YELLOW}→ 로그: $NPM_LOG${NC}"
    echo -e "  ${YELLOW}→ tail -20 $NPM_LOG${NC}"
    exit 1
  }
  echo -e "  ${GREEN}✓ 업데이트 완료${NC}"
  verify_better_sqlite3
else
  echo -e "${YELLOW}2. AI Quartermaster 설치...${NC}"
  git clone --depth 1 "$REPO_URL" "$AQM_HOME" --quiet
  cd "$AQM_HOME"
  npm install --silent 2>"$NPM_LOG" || {
    echo -e "  ${RED}✗ npm install 실패${NC}"
    echo -e "  ${YELLOW}→ 로그: $NPM_LOG${NC}"
    echo -e "  ${YELLOW}→ tail -20 $NPM_LOG${NC}"
    exit 1
  }
  echo -e "  ${GREEN}✓ 설치 완료: $AQM_HOME${NC}"
  verify_better_sqlite3
fi
echo ""

# 3. Install aqm wrapper from bin/aqm
echo -e "${YELLOW}3. aqm 명령어 등록...${NC}"
mkdir -p "$BIN_DIR"
cp "$AQM_HOME/bin/aqm" "$BIN_DIR/aqm"
chmod +x "$BIN_DIR/aqm"
echo -e "  ${GREEN}✓ aqm 명령어 생성: $BIN_DIR/aqm${NC}"

# 4. Add to PATH if needed
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo ""
  echo -e "${YELLOW}4. PATH 등록...${NC}"

  SHELL_RC=""
  if [ -f "$HOME/.zshrc" ]; then
    SHELL_RC="$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then
    SHELL_RC="$HOME/.bashrc"
  elif [ -f "$HOME/.bash_profile" ]; then
    SHELL_RC="$HOME/.bash_profile"
  fi

  if [ -n "$SHELL_RC" ]; then
    if ! grep -q '.local/bin' "$SHELL_RC" 2>/dev/null; then
      echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
      echo -e "  ${GREEN}✓ $SHELL_RC에 PATH 추가됨${NC}"
      echo -e "  ${YELLOW}→ 새 터미널을 열거나 source $SHELL_RC 실행하세요${NC}"
    else
      echo -e "  ${GREEN}✓ PATH 이미 등록됨${NC}"
    fi
  else
    echo -e "  ${YELLOW}→ $BIN_DIR 를 PATH에 수동 추가하세요${NC}"
  fi
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        설치 완료!                      ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""
echo "Quick Start:"
echo "  aqm setup                                       초기 설정"
echo "  aqm start --daemon --mode polling               폴링 모드 백그라운드 실행"
echo ""
echo "Commands:"
echo "  aqm start [--daemon] [--mode polling]           서버 시작"
echo "  aqm stop / restart / logs                       서버 관리"
echo "  aqm run --issue <n> --repo <owner/repo>         수동 실행"
echo "  aqm resume --job <id>                           실패 파이프라인 재개"
echo "  aqm plan --repo <owner/repo>                    이슈 분석"
echo "  aqm status / stats / doctor                     모니터링"
echo "  aqm help                                        전체 명령어"
echo ""
