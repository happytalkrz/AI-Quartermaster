#!/usr/bin/env bash
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

AQM_INSTALL_MODE="${AQM_INSTALL_MODE:-npm}"
AQM_HOME="${AQM_HOME:-$HOME/.ai-quartermaster}"
BIN_DIR="${HOME}/.local/bin"
REPO_URL="https://github.com/happytalkrz/AI-Quartermaster.git"

# ── OS / WSL 감지 ──────────────────────────────────────────────────────
detect_os() {
  case "$(uname -s 2>/dev/null)" in
    Darwin)
      echo "macos"
      ;;
    Linux)
      # WSL_DISTRO_NAME / WSL_INTEROP 환경변수 체크 (detect-wsl.ts 동일 로직)
      if [ -n "${WSL_DISTRO_NAME:-}" ] || [ -n "${WSL_INTEROP:-}" ]; then
        echo "wsl"
        return
      fi
      # /proc/sys/kernel/osrelease 파일 체크 (detect-wsl.ts 동일 로직)
      if [ -f /proc/sys/kernel/osrelease ]; then
        local release
        release=$(cat /proc/sys/kernel/osrelease 2>/dev/null | tr '[:upper:]' '[:lower:]')
        if echo "$release" | grep -qE 'microsoft|wsl'; then
          echo "wsl"
          return
        fi
      fi
      echo "linux"
      ;;
    MINGW*|CYGWIN*|MSYS*)
      # Windows Git Bash / Cygwin 에서 직접 실행된 경우
      echo "windows"
      ;;
    *)
      echo "unknown"
      ;;
  esac
}

OS=$(detect_os)

echo -e "${BLUE}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║   AI Quartermaster 설치               ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# ── Windows 감지: WSL 설치 안내 후 종료 ───────────────────────────────
if [ "$OS" = "windows" ]; then
  echo -e "  ${RED}✗ Windows 환경이 감지되었습니다.${NC}"
  echo ""
  echo -e "  AI Quartermaster는 WSL(Windows Subsystem for Linux)에서 실행해야 합니다."
  echo ""
  echo -e "  ${YELLOW}WSL 설치 방법:${NC}"
  echo "    1. PowerShell(관리자)에서 실행:"
  echo "       wsl --install"
  echo "    2. 재부팅 후 Ubuntu 터미널을 열고 다시 설치 명령을 실행하세요."
  echo ""
  echo "    자세한 안내: https://learn.microsoft.com/ko-kr/windows/wsl/install"
  echo ""
  exit 1
fi

# ── 1. Node.js 확인 ────────────────────────────────────────────────────
echo -e "${YELLOW}1. Node.js 확인...${NC}"

if ! command -v node &>/dev/null; then
  echo -e "  ${RED}✗ Node.js가 설치되어 있지 않습니다.${NC}"
  echo ""
  case "$OS" in
    macos)
      echo -e "  ${YELLOW}macOS — Node.js 설치 방법:${NC}"
      echo "    brew install node"
      echo "    또는: https://nodejs.org/en/download"
      ;;
    wsl|linux)
      echo -e "  ${YELLOW}Linux/WSL — Node.js 설치 방법:${NC}"
      echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
      echo "    sudo apt-get install -y nodejs"
      echo "    또는: https://nodejs.org/en/download"
      ;;
    *)
      echo -e "  ${YELLOW}Node.js 설치: https://nodejs.org/en/download${NC}"
      ;;
  esac
  echo ""
  echo "  Node.js 20 이상 설치 후 다시 실행하세요."
  exit 1
fi

NODE_VERSION=$(node -e "process.stdout.write(process.version)" 2>/dev/null)
NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
if [ "${NODE_MAJOR:-0}" -lt 20 ] 2>/dev/null; then
  echo -e "  ${RED}✗ Node.js $NODE_VERSION — v20 이상 필요합니다.${NC}"
  echo "  https://nodejs.org/en/download 에서 최신 LTS를 설치하세요."
  exit 1
fi
echo -e "  ${GREEN}✓ Node.js $NODE_VERSION${NC}"

if ! command -v npm &>/dev/null; then
  echo -e "  ${RED}✗ npm이 없습니다. Node.js를 재설치하세요: https://nodejs.org${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓ npm $(npm --version 2>/dev/null)${NC}"

# gh / claude 확인 (선택 사항 — 경고만 출력)
echo ""
echo -e "${YELLOW}  [선택 도구 확인]${NC}"
check_optional() {
  local cmd="$1" url="$2"
  if ! command -v "$cmd" &>/dev/null; then
    echo -e "  ${YELLOW}⚠ $cmd 없음 — 나중에 설치: $url${NC}"
  else
    echo -e "  ${GREEN}✓ $cmd${NC}"
  fi
}
check_optional "gh"     "https://cli.github.com"
check_optional "claude" "https://docs.anthropic.com/en/docs/claude-code"
echo ""

# ── 2. 설치 ────────────────────────────────────────────────────────────
NPM_LOG=$(mktemp /tmp/aqm-install-XXXXXX.log)

if [ "$AQM_INSTALL_MODE" = "git" ]; then
  # ── git-clone 모드 (AQM_INSTALL_MODE=git) ─────────────────────────
  echo -e "${YELLOW}2. AI Quartermaster 설치 (git 모드)...${NC}"

  if ! command -v git &>/dev/null; then
    echo -e "  ${RED}✗ git — https://git-scm.com 에서 설치하세요${NC}"
    exit 1
  fi

  if [ -d "$AQM_HOME" ]; then
    echo -e "  기존 설치 업데이트..."
    cd "$AQM_HOME"
    git pull --quiet
    npm install --silent 2>"$NPM_LOG" || {
      echo -e "  ${RED}✗ npm install 실패${NC}"
      echo -e "  ${YELLOW}→ 로그: $NPM_LOG${NC}"
      tail -20 "$NPM_LOG"
      exit 1
    }
    echo -e "  ${GREEN}✓ 업데이트 완료${NC}"
  else
    git clone --depth 1 "$REPO_URL" "$AQM_HOME" --quiet
    cd "$AQM_HOME"
    npm install --silent 2>"$NPM_LOG" || {
      echo -e "  ${RED}✗ npm install 실패${NC}"
      echo -e "  ${YELLOW}→ 로그: $NPM_LOG${NC}"
      tail -20 "$NPM_LOG"
      exit 1
    }
    echo -e "  ${GREEN}✓ 설치 완료: $AQM_HOME${NC}"
  fi

  # better-sqlite3 로드 검증
  echo -e "${YELLOW}  [better-sqlite3 로드 검증]${NC}"
  if node -e "require('better-sqlite3')" 2>/dev/null; then
    echo -e "  ${GREEN}✓ better-sqlite3 정상 로드${NC}"
  else
    echo -e "  ${RED}✗ better-sqlite3 로드 실패${NC}"
    echo ""
    echo -e "  ${YELLOW}해결 방법:${NC}"
    echo "  1. python3, make, g++ 설치 후 npm rebuild better-sqlite3 실행"
    echo "  2. 문제가 지속되면 이슈를 제보하세요:"
    echo "     https://github.com/happytalkrz/AI-Quartermaster/issues"
    exit 1
  fi
  echo ""

  # aqm wrapper 등록
  echo -e "${YELLOW}3. aqm 명령어 등록...${NC}"
  mkdir -p "$BIN_DIR"
  cp "$AQM_HOME/bin/aqm" "$BIN_DIR/aqm"
  chmod +x "$BIN_DIR/aqm"
  echo -e "  ${GREEN}✓ aqm 명령어 생성: $BIN_DIR/aqm${NC}"

  # PATH 등록
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

else
  # ── npm global 모드 (기본) ─────────────────────────────────────────
  echo -e "${YELLOW}2. AI Quartermaster 설치 (npm global)...${NC}"
  npm install -g ai-quartermaster 2>"$NPM_LOG" || {
    echo -e "  ${RED}✗ npm install -g 실패${NC}"
    echo -e "  ${YELLOW}→ 로그: $NPM_LOG${NC}"
    tail -20 "$NPM_LOG"
    exit 1
  }
  echo -e "  ${GREEN}✓ ai-quartermaster 설치 완료${NC}"
  echo ""

  # aqm 명령어 PATH 확인
  echo -e "${YELLOW}3. aqm 명령어 확인...${NC}"
  if command -v aqm &>/dev/null; then
    echo -e "  ${GREEN}✓ aqm 정상 등록됨${NC}"
  else
    NPM_GLOBAL_BIN=$(npm prefix -g 2>/dev/null)/bin
    echo -e "  ${YELLOW}⚠ aqm 명령어가 PATH에 없습니다.${NC}"
    echo -e "  ${YELLOW}→ 다음을 실행하여 PATH에 추가하세요:${NC}"
    echo "    export PATH=\"\$PATH:$NPM_GLOBAL_BIN\""
    echo ""
    SHELL_RC=""
    if [ -f "$HOME/.zshrc" ]; then
      SHELL_RC="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
      SHELL_RC="$HOME/.bashrc"
    elif [ -f "$HOME/.bash_profile" ]; then
      SHELL_RC="$HOME/.bash_profile"
    fi
    if [ -n "$SHELL_RC" ]; then
      if ! grep -qF "$NPM_GLOBAL_BIN" "$SHELL_RC" 2>/dev/null; then
        echo "export PATH=\"\$PATH:$NPM_GLOBAL_BIN\"" >> "$SHELL_RC"
        echo -e "  ${GREEN}✓ $SHELL_RC에 PATH 추가됨${NC}"
        echo -e "  ${YELLOW}→ 새 터미널을 열거나 source $SHELL_RC 실행하세요${NC}"
      fi
    fi
  fi
fi

# ── 완료 메시지 ────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        설치 완료!                      ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""

# ── aqm setup 자동 호출 ────────────────────────────────────────────────
if command -v aqm &>/dev/null; then
  echo -e "${YELLOW}초기 설정을 시작합니다...${NC}"
  echo ""
  aqm setup
else
  echo "설치 후 새 터미널을 열고 다음 명령어로 초기 설정을 완료하세요:"
  echo ""
  echo "  aqm setup"
  echo ""
  echo "Commands:"
  echo "  aqm start [--daemon] [--mode polling]           서버 시작"
  echo "  aqm stop / restart / logs                       서버 관리"
  echo "  aqm run --issue <n> --repo <owner/repo>         수동 실행"
  echo "  aqm status / stats / doctor                     모니터링"
  echo "  aqm help                                        전체 명령어"
  echo ""
fi
