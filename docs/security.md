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

## Sensitive Path Guard 정책

AQM은 민감한 경로(`.github/workflows/**` 등)를 수정하는 이슈가 자동으로 처리되는 것을 방지하기 위해 **Sensitive Path Guard**를 내장하고 있습니다.

### 판정 매트릭스

파일별로 아래 순서대로 판정합니다:

| 단계 | 조건 | 결과 | reason |
|------|------|------|--------|
| 1 | 민감 패턴에 매칭되지 않음 | **허용** | `no-match` |
| 2 | `.github/workflows/**` + `allow-ci` 라벨 + 관련파일 명시 + **admin/maintain 권한** | **허용** | `allow-ci-label` |
| 2-거부 | 조건 2와 동일하나 권한이 write/read/none | **차단** | `insufficient-permission` |
| 3 | 이슈 본문 `## 관련 파일` 섹션에 명시된 경로 | **허용** | `related-file` |
| 4 | 그 외 민감 패턴 매칭 | **차단** | `sensitive-violation` |

> **참고**: `senderPermission`이 제공되지 않은 경우(API 미설정 등) 단계 2는 권한 미확인으로 허용됩니다.

### `.github/workflows/**` 예외 조건

워크플로 파일(`.github/workflows/**`)은 세 가지 조건을 **모두** 충족해야 예외가 적용됩니다:

1. **`allow-ci` 라벨** — 이슈에 `allow-ci` 라벨이 붙어 있어야 합니다.
2. **관련 파일 명시** — 이슈 본문의 `## 관련 파일` 섹션에 해당 워크플로 파일 경로가 백틱으로 명시되어 있어야 합니다.
3. **admin 또는 maintain 권한** — 이슈 작성자(sender)가 해당 repository에서 `admin` 또는 `maintain` 권한을 보유해야 합니다.

**이슈 본문 예시:**

```markdown
## 관련 파일
- `.github/workflows/ci.yml`
- `src/utils/helper.ts`
```

### sender permission level별 동작 매트릭스

| 권한 수준 | 워크플로 파일 (`allow-ci` + 관련파일 명시) | 일반 민감 파일 |
|----------|------------------------------------------|--------------|
| `admin` | 허용 (`allow-ci-label`) | 관련파일 명시 시 허용 |
| `maintain` | 허용 (`allow-ci-label`) | 관련파일 명시 시 허용 |
| `write` | **차단** (`insufficient-permission`) | 관련파일 명시 시 허용 |
| `read` | **차단** (`insufficient-permission`) | 관련파일 명시 시 허용 |
| `none` | **차단** (`insufficient-permission`) | 관련파일 명시 시 허용 |
| 미확인 (undefined) | 허용 (`allow-ci-label`) | 관련파일 명시 시 허용 |

### allow-ci 라벨 보호 설정 (GitHub Label Protection)

`allow-ci` 라벨은 repository owner 또는 maintainer만 적용할 수 있도록 GitHub에서 라벨 접근을 제한하는 것을 권장합니다.

**설정 방법:**

1. **Branch Protection 규칙 활용**: `.github/workflows/**`를 수정하는 PR은 별도 리뷰어 승인을 요구하도록 branch protection rules에 `CODEOWNERS` 파일을 추가합니다.

   ```
   # .github/CODEOWNERS
   .github/workflows/ @your-org/maintainers
   ```

2. **Label 관리 제한**: GitHub repository settings에서 collaborators의 역할을 `Triage` 이하로 제한하면 `write` 미만 권한을 가진 사용자가 라벨을 추가할 수 없습니다.

3. **자동화 검증**: AQM의 `senderPermission` 검증이 GitHub Collaborators API를 통해 실시간으로 권한을 확인하므로, 라벨이 붙어 있더라도 권한 부족 시 자동으로 차단됩니다.

### 권한 부족 시 대응 방법

워크플로 파일 수정이 `insufficient-permission`으로 차단된 경우:

1. **repository 관리자에게 요청** — `admin` 또는 `maintain` 권한을 보유한 사람이 이슈를 직접 제출하거나 권한을 부여받아야 합니다.
2. **이슈 재제출** — 권한을 가진 계정으로 이슈를 다시 생성합니다.
3. **수동 처리** — 워크플로 파일 변경은 자동화 파이프라인 대신 수동 PR로 처리합니다.

에러 메시지 예시:

```
Sensitive files modified:
.github/workflows/ci.yml

Workflow file changes via `allow-ci` require admin or maintain repository permissions.
repository 관리자에게 요청하세요.
```

---

## 관련 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DASHBOARD_API_KEY` | (없음) | Bearer 인증 키. 설정 시 모든 API 엔드포인트에 인증 필요 |
| `DASHBOARD_ALLOW_INSECURE` | `false` | `true` 설정 시 non-local bind에서 API Key 없이 실행 허용 (비권장) |
