# Dashboard Security Policy

## 인증 계층 (Authentication Tiers)

AQM 대시보드는 바인드 주소와 환경에 따라 세 가지 인증 계층을 제공합니다.

| 계층 | 바인드 주소 | 환경 | 인증 요구 | 기본 접근 수준 |
|------|------------|------|----------|--------------|
| **Tier 0** | `127.0.0.1` / `localhost` | 일반 | 없음 | Full access |
| **Tier 1** | `0.0.0.0` | WSL | 없음 (경고만) | Full access |
| **Tier 2** | `0.0.0.0` / 임의 | 모두 | API Key 필수 | Full access |

> **WSL 환경 주의**: Tier 1은 로컬 개발 편의를 위한 기본값입니다. 네트워크에 노출된 환경에서는 반드시 API Key(Tier 2)를 설정하세요.

---

## WSL 0.0.0.0 바인딩 정책

### 왜 WSL에서 0.0.0.0으로 자동 바인딩되는가

WSL(Windows Subsystem for Linux)은 Linux VM과 Windows 호스트 사이의 가상 네트워크를 통해 통신합니다. `127.0.0.1`로 바인딩하면 Windows 브라우저에서 대시보드에 접근할 수 없기 때문에, AQM은 WSL 환경을 자동으로 감지하여 `0.0.0.0`으로 바인딩합니다.

**WSL 감지 기준:**
- 환경변수 `WSL_DISTRO_NAME` 또는 `WSL_INTEROP` 존재
- `/proc/sys/kernel/osrelease`에 `microsoft` 또는 `wsl` 포함

### 기본 정책 (API Key 미설정 시)

API Key를 설정하지 않은 WSL 환경에서는:

- 대시보드가 `0.0.0.0`에 바인딩되어 **같은 네트워크의 모든 기기**에서 접근 가능
- 모든 API 엔드포인트(config 수정, 잡 취소, 시스템 업데이트 등)가 **인증 없이** 접근 가능
- 시작 시 경고 로그가 출력되나 실행은 차단되지 않음

```
[WARN] WSL 환경 감지: 대시보드를 0.0.0.0:3000에 인증 없이 바인딩합니다.
       보안이 필요한 환경에서는 DASHBOARD_API_KEY를 설정하세요.
```

**이 정책은 단일 사용자 로컬 개발 환경을 위한 것입니다.** 공유 네트워크, 사무실 Wi-Fi, 서버 환경에서는 API Key를 필수로 설정하세요.

---

## API Key 설정 가이드

### 1. API Key 생성

추측하기 어려운 랜덤 문자열을 사용하세요:

```bash
# openssl 사용 (권장)
openssl rand -hex 32

# /dev/urandom 사용
head -c 32 /dev/urandom | base64
```

### 2. 환경변수 설정

```bash
export DASHBOARD_API_KEY=<생성한-키>
aqm start
```

영구 설정이 필요하면 셸 프로파일(`~/.bashrc`, `~/.zshrc`)에 추가하세요:

```bash
echo 'export DASHBOARD_API_KEY=<생성한-키>' >> ~/.bashrc
source ~/.bashrc
```

### 3. API Key로 인증

API Key가 설정되면 모든 `/api/*` 엔드포인트에 `Authorization` 헤더가 필요합니다.

**세션 토큰 발급 (권장):**

```bash
curl -X POST http://localhost:3000/api/auth \
  -H "Authorization: Bearer <your-api-key>"
# 응답: { "token": "<session-token>", "expiresAt": "..." }
```

발급된 세션 토큰을 이후 요청에 사용합니다:

```bash
curl http://localhost:3000/api/jobs \
  -H "Authorization: Bearer <session-token>"
```

**직접 Bearer 인증:**

```bash
curl http://localhost:3000/api/jobs \
  -H "Authorization: Bearer <your-api-key>"
```

### 4. 대시보드 UI 접근

브라우저에서 대시보드를 열면 API Key 입력 프롬프트가 표시됩니다. API Key를 입력하면 세션 토큰이 자동으로 발급되어 브라우저에 저장됩니다.

---

## DASHBOARD_ALLOW_INSECURE 사용 주의사항

`DASHBOARD_ALLOW_INSECURE=true`는 non-local bind 환경에서 API Key 없이 실행을 허용하는 **긴급 우회 옵션**입니다.

```bash
export DASHBOARD_ALLOW_INSECURE=true
aqm start --host 0.0.0.0
```

**이 옵션 사용 시:**

- 모든 API 엔드포인트가 **인증 없이** 네트워크에 노출됩니다
- config 수정, 프로젝트 삭제, 잡 취소, 시스템 업데이트가 무인증으로 가능합니다
- 보안 감사 로그에 기록되지 않습니다

**사용이 허용되는 경우:**
- 완전히 격리된 내부 네트워크 (외부 인터넷 접근 불가)
- 일시적인 디버깅 목적 (디버깅 완료 후 즉시 제거)

**절대 사용하지 말아야 하는 경우:**
- 인터넷에 연결된 서버
- 공유 사무실 네트워크
- 프로덕션 또는 스테이징 환경
- 다른 사용자가 접근 가능한 모든 환경

---

## 보안 권장사항 요약

| 환경 | 권장 설정 |
|------|---------|
| 로컬 단독 개발 (비WSL) | 기본값 (`127.0.0.1`) — 추가 설정 불필요 |
| WSL 로컬 개발 | `DASHBOARD_API_KEY` 설정 권장 |
| 공유 네트워크 / 사무실 | `DASHBOARD_API_KEY` 설정 **필수** |
| 원격 서버 / VPS | `DASHBOARD_API_KEY` 설정 필수 + 방화벽으로 포트 제한 |
| 프로덕션 | `DASHBOARD_API_KEY` 필수 + reverse proxy + TLS |

---

## 관련 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DASHBOARD_API_KEY` | (없음) | Bearer 인증 키. 설정 시 모든 API 엔드포인트에 인증 필요 |
| `DASHBOARD_ALLOW_INSECURE` | `false` | `true` 설정 시 non-local bind에서 API Key 없이 실행 허용 (비권장) |
