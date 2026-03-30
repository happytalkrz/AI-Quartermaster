# AI Quartermaster (AQM)

GitHub Issue에 라벨을 붙이면 Claude가 자동으로 구현하고 Draft PR을 만들어줍니다.

## 설치

```bash
curl -fsSL https://raw.githubusercontent.com/happytalkrz/AI-Quartermaster/main/install.sh | bash
```

**필수 요구사항:**
- macOS / Linux / WSL (Windows 네이티브 미지원)
- Node.js 20+
- Git
- [GitHub CLI](https://cli.github.com) (`gh auth login` 완료)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) (Claude Max 요금제 권장)

**Public / Private 레포 모두 지원** — `gh auth login` 인증 토큰에 repo 접근 권한이 있으면 Private 레포에서도 동작합니다.

## 빠른 시작

```bash
# 1. 초기 설정 (config, .env, credential 자동 구성)
aqm setup

# 2. config.yml 수정 — projects 섹션에 대상 프로젝트 추가
#    (아래 '설정' 섹션 참고)

# 3. 서버 시작
aqm start --daemon --mode polling          # 폴링 모드 (추천, webhook 설정 불필요)
aqm start --daemon                         # 웹훅 모드 (smee.io 자동 연결)

# 4. GitHub 이슈에 'ai-quartermaster' 라벨 붙이기 → 자동 실행!
```

## 작동 방식

```
GitHub Issue (라벨 트리거)
  → AQM이 이슈 감지 (폴링 또는 웹훅)
  → Claude가 구현 계획(Plan) 수립 (opus)
  → Phase별 구현 실행 (sonnet)
  → 코드 리뷰 (haiku)
  → 테스트/린트 검증
  → Draft PR 생성
  → 이슈에 결과 코멘트
```

## 명령어

### 서버

```bash
aqm start                                       # 웹훅 서버 (포그라운드)
aqm start --daemon                              # 백그라운드 실행
aqm start --mode polling                        # 폴링 모드 (60초 간격)
aqm start --mode polling --interval 30          # 30초 간격 폴링
aqm start --daemon --mode polling --port 8080   # 모든 옵션 조합 가능
aqm stop                                        # 서버 중지
aqm restart                                     # 서버 재시작
aqm logs                                        # 서버 로그 실시간 확인
```

### 파이프라인

```bash
aqm run --issue 42 --repo owner/repo            # 특정 이슈 수동 실행
aqm resume --job <id>                           # 실패한 파이프라인을 마지막 체크포인트에서 재개
aqm resume --issue 42 --repo owner/repo         # 이슈 번호로 재개
aqm plan --repo owner/repo                      # 열린 이슈 분석 → 실행 계획 출력
aqm plan --repo owner/repo --execute            # 분석 후 자동 실행
```

### 모니터링

```bash
aqm status                                      # 큐 상태 (대기/실행 중/완료)
aqm stats                                       # 성공률, 실패 패턴, 평균 시간
aqm stats --repo owner/repo                     # 프로젝트별 통계
aqm doctor                                      # 환경 점검 (git, gh, claude, 포트 등)
```

### 관리

```bash
aqm setup                                       # 초기 설정
aqm setup-webhook --repo owner/repo             # GitHub webhook 수동 등록
aqm cleanup                                     # 오래된 worktree 정리
aqm update                                      # 최신 버전 업데이트
aqm version                                     # 버전 확인
aqm uninstall                                   # 완전 삭제
aqm help                                        # 전체 명령어 도움말
```

## 실행 모드

### 폴링 모드 (추천)
주기적으로 GitHub API를 호출해서 트리거 라벨이 붙은 이슈를 감지합니다.
webhook이나 smee.io 설정이 필요 없어서 간편합니다.

```bash
aqm start --mode polling                        # 기본 60초 간격
aqm start --mode polling --interval 30          # 30초 간격
```

### 웹훅 모드
GitHub webhook → smee.io 프록시 → AQM 서버. 실시간 반응이 필요할 때.
`aqm setup`에서 smee 채널이 자동 생성됩니다.

```bash
aqm start                                       # webhook 모드 (기본)
```

## 설정 (config.yml)

`aqm setup` 실행 시 `~/.ai-quartermaster/config.yml`이 자동 생성됩니다.

### 프로젝트 등록 (필수)

```yaml
projects:
  - repo: "myorg/my-repo"              # GitHub 저장소 (owner/repo 형식)
    path: "/home/user/my-repo"         # 로컬 클론 절대 경로
    baseBranch: "main"                 # 기본 브랜치
```

여러 프로젝트 등록 가능:

```yaml
projects:
  - repo: "myorg/frontend"
    path: "/home/user/frontend"
    baseBranch: "main"
    commands:
      test: "yarn test"
      lint: "yarn lint"
  - repo: "myorg/backend"
    path: "/home/user/backend"
    baseBranch: "develop"
    commands:
      test: "go test ./..."
      lint: "golangci-lint run"
```

### 동시 실행

```yaml
general:
  concurrency: 1                       # 동시 파이프라인 수 (기본: 1)
  # concurrency: 3                     # 3개 병렬 실행
```

### 모델 라우팅

태스크별로 다른 Claude 모델을 사용합니다:

```yaml
commands:
  claudeCli:
    model: "claude-sonnet-4-20250514"           # 글로벌 기본
    models:
      plan: "claude-opus-4-5"                   # Plan 생성 (복잡한 분석)
      phase: "claude-sonnet-4-20250514"         # Phase 구현 (코딩)
      review: "claude-haiku-4-5-20251001"       # 리뷰/검증 (빠른 확인)
      fallback: "claude-sonnet-4-20250514"      # 실패 시 재시도
```

### 안전장치

```yaml
safety:
  maxPhases: 10                        # 최대 Phase 수
  maxRetries: 3                        # Phase 실패 시 재시도 횟수
  maxFileChanges: 50                   # 최대 변경 파일 수
  maxInsertions: 2000                  # 최대 추가 라인
  maxDeletions: 1000                   # 최대 삭제 라인
  rollbackStrategy: "none"            # 실패 시 롤백: none / all / failed-only
  sensitivePaths:                      # 수정 금지 경로
    - ".env"
    - "*.pem"
    - "secrets/**"
  allowedLabels:                       # 트리거 라벨 (이슈에 이 라벨이 있어야 실행)
    - "ai-quartermaster"
```

### 리뷰 설정

```yaml
review:
  enabled: true
  rounds:                              # 리뷰 라운드 (순차 실행)
    - name: "code-review"
      promptTemplate: "review-round1.md"
      failAction: "warn"               # block: 중단 / warn: 경고 후 계속 / retry: 재시도
      maxRetries: 2
  simplify:
    enabled: true                      # 코드 간소화 단계 활성화
```

### PR 설정

```yaml
pr:
  draft: true                          # Draft PR로 생성 (기본)
  autoMerge: false                     # CI 통과 시 자동 머지
  mergeMethod: "squash"                # merge / squash / rebase
  labels: ["ai-generated"]
  linkIssue: true                      # PR에 이슈 링크 자동 추가
```

### 기타 설정

```yaml
general:
  logLevel: "info"                     # debug / info / warn / error
  dryRun: false                        # true: push/PR 생성 스킵
  pollingIntervalMs: 60000             # 폴링 간격 (ms)
  stuckTimeoutMs: 600000               # stuck job 감지 타임아웃 (ms)
  maxJobs: 500                         # 최대 job 보관 수

commands:
  claudeMdPath: "CLAUDE.md"           # 프로젝트 컨벤션 파일 (자동 주입)
  test: "npm test"
  lint: "npm run lint"
  build: "npm run build"
  typecheck: "npx tsc --noEmit"
  preInstall: "npm ci"                 # worktree 생성 후 의존성 설치
```

## 대시보드

`http://localhost:3000` — 실시간 작업 상태, Phase 진행률, 로그 스트리밍.

- 다크/라이트 테마 전환
- 한국어/영어 전환
- 작업 필터링 (실행 중/성공/실패/대기)
- 실패 작업 재시도 버튼

### 대시보드 인증 (선택)

`.env`에 API 키를 설정하면 대시보드 접근에 인증이 필요합니다:

```env
DASHBOARD_API_KEY=your-secret-key-here
```

## 이슈 의존성

이슈 본문에 `depends: #11` 또는 `depends: #11, #12`를 작성하면
의존 이슈의 파이프라인이 완료된 후 자동으로 실행됩니다.

```markdown
<!-- 이슈 본문 예시 -->
로그인 페이지 구현

depends: #10

- [ ] 로그인 폼 UI
- [ ] API 연동
```

## 환경 점검

설치 후 또는 문제 발생 시:

```bash
aqm doctor
```

git, gh, claude CLI 설치 여부, 인증 상태, 프로젝트 경로, 포트 가용성 등을 자동 점검합니다.

## 라이선스

MIT
