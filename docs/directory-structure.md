# AI 병참부 - 디렉토리 구조 제안

## 1. 전체 프로젝트 구조

```
AI-Quartermaster/
├── .github/
│   └── workflows/
│       └── ci.yml                    # CI 파이프라인 (lint, test, build)
│
├── docs/
│   ├── architecture.md               # 아키텍처 설계서
│   ├── state-machine.md              # 상태 전이 흐름도
│   └── directory-structure.md        # 디렉토리 구조 제안 (본 문서)
│
├── prompts/                          # Claude CLI 프롬프트 템플릿
│   ├── plan.md                       # 구현 계획 생성 프롬프트
│   ├── implement-phase.md            # Phase 구현 프롬프트
│   ├── fix-phase-error.md            # Phase 오류 수정 프롬프트
│   ├── review-accuracy.md            # 리뷰 1라운드: 정확성
│   ├── review-quality.md             # 리뷰 2라운드: 품질
│   ├── review-integration.md         # 리뷰 3라운드: 통합
│   ├── simplify.md                   # 코드 단순화 프롬프트
│   ├── fix-final-validation.md       # 최종 검증 오류 수정 프롬프트
│   └── pr-body.md                    # PR 본문 템플릿
│
├── src/
│   ├── index.ts                      # 애플리케이션 진입점
│   ├── config.ts                     # 환경변수 로드 및 설정 객체
│   │
│   ├── webhook/                      # Webhook 수신 계층
│   │   ├── server.ts                 # Hono HTTP 서버 생성 및 미들웨어 등록
│   │   ├── routes.ts                 # POST /webhook/github 라우트 정의
│   │   ├── verify-signature.ts       # HMAC-SHA256 서명 검증 미들웨어
│   │   └── filter.ts                 # Issue 이벤트 필터 (라벨, 액션, repo 검증)
│   │
│   ├── queue/                        # Job 큐 관리
│   │   ├── job.ts                    # Job 인터페이스 및 생성 함수
│   │   ├── dispatcher.ts             # Job 큐, 동시성 제어, 타임아웃 관리
│   │   └── state-store.ts            # Job 상태 저장/조회/전이 (파일 기반)
│   │
│   ├── pipeline/                     # 핵심 파이프라인 오케스트레이션
│   │   ├── runner.ts                 # PipelineRunner: 상태 머신 기반 실행 루프
│   │   ├── states.ts                 # PipelineState enum 및 전이 규칙
│   │   ├── handlers/                 # 각 상태별 핸들러
│   │   │   ├── received.ts           # RECEIVED 핸들러
│   │   │   ├── validated.ts          # VALIDATED 핸들러 (Issue 파싱, base branch 결정)
│   │   │   ├── base-synced.ts        # BASE_SYNCED 핸들러 (git fetch)
│   │   │   ├── branch-created.ts     # BRANCH_CREATED 핸들러 (브랜치 생성, 충돌 해소)
│   │   │   ├── worktree-created.ts   # WORKTREE_CREATED 핸들러
│   │   │   ├── plan-generated.ts     # PLAN_GENERATED 핸들러 (Claude 계획 생성)
│   │   │   ├── phase-in-progress.ts  # PHASE_IN_PROGRESS 핸들러 (구현 루프)
│   │   │   ├── phase-failed.ts       # PHASE_FAILED 핸들러 (오류 수정 재시도)
│   │   │   ├── reviewing.ts          # REVIEWING 핸들러 (3라운드 리뷰)
│   │   │   ├── simplifying.ts        # SIMPLIFYING 핸들러
│   │   │   ├── final-validating.ts   # FINAL_VALIDATING 핸들러
│   │   │   └── draft-pr-created.ts   # DRAFT_PR_CREATED 핸들러
│   │   └── plan-parser.ts            # Claude 응답에서 ImplementationPlan 파싱
│   │
│   ├── git/                          # Git 작업 캡슐화
│   │   ├── git-manager.ts            # GitManager 클래스 (simple-git 래핑)
│   │   ├── worktree.ts               # Worktree 생성/제거/경로 관리
│   │   ├── branch.ts                 # 브랜치 생성/삭제/충돌 해소
│   │   └── slug.ts                   # Issue 제목 → 브랜치명 slug 변환
│   │
│   ├── claude/                       # Claude CLI 연동
│   │   ├── bridge.ts                 # ClaudeCLIBridge: subprocess 실행, stdin/stdout 관리
│   │   ├── prompt-renderer.ts        # 프롬프트 템플릿 로드 및 변수 치환
│   │   └── output-parser.ts          # Claude CLI JSON 출력 파싱
│   │
│   ├── verify/                       # 코드 검증
│   │   ├── verifier.ts               # Verifier: typecheck, lint, test, build 실행
│   │   └── sensitive-check.ts        # 민감 파일/내용 검사
│   │
│   ├── github/                       # GitHub API 연동
│   │   ├── api.ts                    # gh CLI 래핑: PR 생성, 코멘트, 라벨 관리
│   │   └── comment-formatter.ts      # Issue 코멘트 마크다운 포매터
│   │
│   ├── safeguard/                    # 보호장치
│   │   ├── branch-protection.ts      # 보호 브랜치 접근 차단
│   │   ├── path-protection.ts        # 보호 경로 수정 감지
│   │   ├── command-filter.ts         # 금지 명령어 패턴 감지
│   │   └── repo-allowlist.ts         # 허용 Repository 관리
│   │
│   ├── logger/                       # 로깅
│   │   ├── logger.ts                 # 구조화된 로거 (JSON 포맷)
│   │   └── log-store.ts              # 실패 로그 파일 저장/조회/정리
│   │
│   ├── retry/                        # 재시도 유틸리티
│   │   └── retry.ts                  # 지수 백오프 재시도 함수
│   │
│   └── types/                        # 공유 타입 정의
│       ├── github.ts                 # GitHub 이벤트 타입 (GitHubIssueEvent 등)
│       ├── pipeline.ts               # PipelineState, Job, ImplementationPlan 등
│       ├── verification.ts           # VerificationResult, VerificationCheck 등
│       └── config.ts                 # AppConfig 타입
│
├── test/                             # 테스트
│   ├── unit/                         # 단위 테스트
│   │   ├── webhook/
│   │   │   ├── verify-signature.test.ts
│   │   │   └── filter.test.ts
│   │   ├── queue/
│   │   │   ├── dispatcher.test.ts
│   │   │   └── state-store.test.ts
│   │   ├── pipeline/
│   │   │   ├── runner.test.ts
│   │   │   ├── plan-parser.test.ts
│   │   │   └── handlers/
│   │   │       ├── validated.test.ts
│   │   │       ├── branch-created.test.ts
│   │   │       └── ...
│   │   ├── git/
│   │   │   ├── slug.test.ts
│   │   │   ├── branch.test.ts
│   │   │   └── worktree.test.ts
│   │   ├── claude/
│   │   │   ├── prompt-renderer.test.ts
│   │   │   └── output-parser.test.ts
│   │   ├── verify/
│   │   │   └── sensitive-check.test.ts
│   │   └── safeguard/
│   │       ├── branch-protection.test.ts
│   │       ├── path-protection.test.ts
│   │       └── command-filter.test.ts
│   │
│   ├── integration/                  # 통합 테스트
│   │   ├── webhook-to-queue.test.ts  # Webhook → Queue 연동
│   │   ├── pipeline-flow.test.ts     # 상태 머신 전체 흐름 (모킹)
│   │   └── git-worktree.test.ts      # Git worktree 생명주기
│   │
│   └── fixtures/                     # 테스트 픽스처
│       ├── github-events/
│       │   ├── issue-opened.json     # Issue opened 이벤트 샘플
│       │   ├── issue-labeled.json    # Issue labeled 이벤트 샘플
│       │   └── issue-invalid.json    # 유효하지 않은 이벤트 샘플
│       ├── claude-responses/
│       │   ├── plan-response.json    # 계획 생성 응답 샘플
│       │   └── review-response.json  # 리뷰 응답 샘플
│       └── repos/
│           └── sample-project/       # Git 테스트용 샘플 프로젝트
│               ├── package.json
│               └── src/
│                   └── index.ts
│
├── logs/                             # 런타임 로그 (gitignore 대상)
│   ├── app.log                       # 애플리케이션 로그
│   ├── failures/                     # 실패 로그
│   │   └── {jobId}.json              # Job별 실패 상세 로그
│   └── jobs/                         # Job 실행 로그
│       └── {jobId}/
│           ├── pipeline.log          # 파이프라인 실행 로그
│           ├── claude-plan.log       # 계획 생성 Claude 출력
│           ├── claude-phase-{N}.log  # Phase N Claude 출력
│           ├── claude-review-{N}.log # 리뷰 라운드 N Claude 출력
│           ├── claude-simplify.log   # 단순화 Claude 출력
│           └── verification-{step}.log # 검증 결과 로그
│
├── data/                             # 런타임 데이터 (gitignore 대상)
│   └── jobs/                         # Job 상태 저장
│       └── {jobId}.json              # Job 상태 및 이력
│
├── .env.example                      # 환경변수 예시 파일
├── .gitignore                        # Git 무시 규칙
├── .eslintrc.js                      # ESLint 설정 (flat config)
├── tsconfig.json                     # TypeScript 설정
├── tsup.config.ts                    # 빌드 설정
├── vitest.config.ts                  # 테스트 설정
├── package.json                      # 프로젝트 메타데이터 및 의존성
└── README.md                         # 프로젝트 소개 및 사용법
```

---

## 2. 각 디렉토리 상세 설명

### 2.1 `src/webhook/` -- Webhook 수신 계층

| 파일 | 역할 | 주요 export |
|------|------|------------|
| `server.ts` | Hono 앱 인스턴스 생성, 미들웨어 등록 (로깅, CORS, 에러 핸들링) | `createApp(): Hono` |
| `routes.ts` | `POST /webhook/github` 라우트 정의, 요청 본문을 파싱하여 dispatcher에 전달 | `registerRoutes(app: Hono, dispatcher: JobDispatcher)` |
| `verify-signature.ts` | `X-Hub-Signature-256` 헤더로 HMAC-SHA256 서명 검증 | `verifySignature(secret: string): MiddlewareHandler` |
| `filter.ts` | 이벤트 필터링 (action, label, repo, 중복 실행 체크) | `shouldProcess(event: GitHubIssueEvent, activeJobs: Job[]): boolean` |

### 2.2 `src/queue/` -- Job 큐 관리

| 파일 | 역할 | 주요 export |
|------|------|------------|
| `job.ts` | Job 인터페이스 정의, `createJob()` 팩토리 함수 | `Job`, `createJob(event: GitHubIssueEvent): Job` |
| `dispatcher.ts` | FIFO 큐, 동시성 제어 (`maxConcurrentJobs`), 타임아웃 관리, Job 등록/실행/완료 처리 | `JobDispatcher` |
| `state-store.ts` | Job 상태를 파일 시스템에 JSON으로 저장/조회. 상태 전이 유효성 검증 포함 | `StateStore` |

#### State Store 저장 형식

```
data/jobs/{jobId}.json
```

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "issueNumber": 42,
  "repository": "owner/repo",
  "baseBranch": "main",
  "branchName": "aq/42-add-user-login",
  "worktreePath": "/tmp/ai-quartermaster/worktrees/550e8400-e29b-41d4-a716-446655440000",
  "status": "PHASE_IN_PROGRESS",
  "currentPhase": 2,
  "totalPhases": 4,
  "retryCount": 0,
  "createdAt": "2026-03-22T10:00:00.000Z",
  "updatedAt": "2026-03-22T10:15:30.000Z",
  "history": [
    { "from": "RECEIVED", "to": "VALIDATED", "at": "2026-03-22T10:00:01.000Z" },
    { "from": "VALIDATED", "to": "BASE_SYNCED", "at": "2026-03-22T10:00:05.000Z" },
    { "from": "BASE_SYNCED", "to": "BRANCH_CREATED", "at": "2026-03-22T10:00:08.000Z" },
    { "from": "BRANCH_CREATED", "to": "WORKTREE_CREATED", "at": "2026-03-22T10:00:15.000Z" },
    { "from": "WORKTREE_CREATED", "to": "PLAN_GENERATED", "at": "2026-03-22T10:02:30.000Z" },
    { "from": "PLAN_GENERATED", "to": "PHASE_IN_PROGRESS", "at": "2026-03-22T10:05:00.000Z" },
    { "from": "PHASE_IN_PROGRESS", "to": "PHASE_IN_PROGRESS", "at": "2026-03-22T10:15:30.000Z", "meta": { "phase": 2 } }
  ]
}
```

### 2.3 `src/pipeline/` -- 핵심 파이프라인

| 파일 | 역할 | 주요 export |
|------|------|------------|
| `runner.ts` | 상태 머신 실행 루프. 각 상태에서 해당 핸들러를 호출하고 상태를 전이 | `PipelineRunner` |
| `states.ts` | `PipelineState` enum, `VALID_TRANSITIONS` 맵, 상태 유효성 검증 함수 | `PipelineState`, `isValidTransition()` |
| `plan-parser.ts` | Claude의 계획 응답 텍스트를 `ImplementationPlan` 구조로 파싱 | `parsePlanResponse(output: string): ImplementationPlan` |
| `handlers/*.ts` | 각 상태별 비즈니스 로직 구현 | `handle{State}(job, context): Promise<TransitionResult>` |

#### handlers 패턴

```typescript
// 모든 핸들러가 따르는 인터페이스
interface StateHandler {
  handle(job: Job, context: PipelineContext): Promise<TransitionResult>;
}

interface TransitionResult {
  nextState: PipelineState;
  metadata?: Record<string, unknown>;
}

interface PipelineContext {
  gitManager: GitManager;
  claudeBridge: ClaudeCLIBridge;
  verifier: Verifier;
  githubAPI: GitHubAPI;
  stateStore: StateStore;
  worktreePath?: string;
  branchName?: string;
  plan?: ImplementationPlan;
  currentPhase?: number;
}
```

### 2.4 `src/git/` -- Git 작업

| 파일 | 역할 | 주요 export |
|------|------|------------|
| `git-manager.ts` | `simple-git` 인스턴스 래핑. fetch, checkout, diff, commit, push 등 모든 git 명령 캡슐화 | `GitManager` |
| `worktree.ts` | worktree 생성(`git worktree add`), 제거(`git worktree remove`), 경로 관리, 고아 정리(`prune`) | `WorktreeManager` |
| `branch.ts` | 브랜치 생성, 삭제, 존재 확인, 충돌 해소 로직 | `createWorkBranch()`, `resolveBranchConflict()` |
| `slug.ts` | Issue 제목을 브랜치명 안전한 slug로 변환. 특수문자 제거, 길이 제한 | `createSlug(title: string): string` |

### 2.5 `src/claude/` -- Claude CLI 연동

| 파일 | 역할 | 주요 export |
|------|------|------------|
| `bridge.ts` | `child_process.spawn`으로 Claude CLI 실행. stdin으로 프롬프트 전달, stdout/stderr 캡처, 타임아웃 관리 | `ClaudeCLIBridge` |
| `prompt-renderer.ts` | `prompts/` 디렉토리에서 `.md` 템플릿 로드 후 `{{변수}}` 치환 | `renderPrompt(template: string, context: PromptContext): string` |
| `output-parser.ts` | Claude CLI의 `--output-format json` 출력 파싱 | `parseClaudeOutput(raw: string): ClaudeOutput` |

### 2.6 `src/verify/` -- 코드 검증

| 파일 | 역할 | 주요 export |
|------|------|------------|
| `verifier.ts` | tsc, eslint, npm test, npm run build를 subprocess로 실행하고 결과를 `VerificationResult`로 반환 | `Verifier` |
| `sensitive-check.ts` | 변경된 파일명 및 diff 내용에서 민감 정보(비밀키, 토큰 등) 패턴 감지 | `checkSensitiveFiles()`, `checkSensitiveContent()` |

### 2.7 `src/github/` -- GitHub API

| 파일 | 역할 | 주요 export |
|------|------|------------|
| `api.ts` | `gh` CLI 래핑. PR 생성, Issue 코멘트, 라벨 추가/제거, PR 존재 여부 확인 | `GitHubAPI` |
| `comment-formatter.ts` | Issue 코멘트용 마크다운 생성 (접수, 계획, 완료, 실패 코멘트) | `formatReceiptComment()`, `formatPlanComment()`, `formatFailureComment()` |

### 2.8 `src/safeguard/` -- 보호장치

| 파일 | 역할 | 주요 export |
|------|------|------------|
| `branch-protection.ts` | 보호 브랜치(main, master 등) 직접 접근 차단, `ax/` 접두사 강제 | `validateBranch(name: string): void` |
| `path-protection.ts` | `.env`, `.github/workflows/`, `*.pem` 등 보호 경로 수정 감지 | `validateChangedFiles(files: string[]): string[]` |
| `command-filter.ts` | `rm -rf /`, `git push --force`, `sudo` 등 위험 명령 패턴 감지 | `isBannedCommand(cmd: string): boolean` |
| `repo-allowlist.ts` | 허용된 Repository만 처리하도록 필터링 | `isRepoAllowed(repo: string): boolean` |

### 2.9 `src/logger/` -- 로깅

| 파일 | 역할 | 주요 export |
|------|------|------------|
| `logger.ts` | 구조화된 JSON 로거. 레벨별 출력 (debug, info, warn, error). Job ID 컨텍스트 자동 포함 | `createLogger(jobId?: string): Logger` |
| `log-store.ts` | 실패 로그를 `logs/failures/{jobId}.json`에 저장. Job별 실행 로그를 `logs/jobs/{jobId}/`에 저장. 30일 이상된 로그 자동 정리 | `LogStore` |

### 2.10 `src/retry/` -- 재시도 유틸리티

| 파일 | 역할 | 주요 export |
|------|------|------------|
| `retry.ts` | 지수 백오프 재시도 함수. `maxRetries`, `initialDelayMs`, `backoff` 전략 지원 | `retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>` |

```typescript
interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  backoff: "exponential" | "linear" | "fixed";
  maxDelayMs?: number;
  onRetry?: (error: Error, attempt: number) => void;
}
```

### 2.11 `src/types/` -- 공유 타입

| 파일 | 역할 | 주요 타입 |
|------|------|----------|
| `github.ts` | GitHub Webhook 이벤트 타입 | `GitHubIssueEvent`, `GitHubLabel`, `GitHubRepository` |
| `pipeline.ts` | 파이프라인 핵심 타입 | `PipelineState`, `Job`, `ImplementationPlan`, `Phase` |
| `verification.ts` | 검증 결과 타입 | `VerificationResult`, `VerificationCheck` |
| `config.ts` | 설정 타입 | `AppConfig` |

---

## 3. 프롬프트 템플릿 디렉토리

```
prompts/
├── plan.md                  # 구현 계획 생성
├── implement-phase.md       # Phase 구현
├── fix-phase-error.md       # Phase 오류 수정
├── review-accuracy.md       # 리뷰 라운드 1
├── review-quality.md        # 리뷰 라운드 2
├── review-integration.md    # 리뷰 라운드 3
├── simplify.md              # 코드 단순화
├── fix-final-validation.md  # 최종 검증 오류 수정
└── pr-body.md               # PR 본문
```

### 템플릿 변수 규칙

모든 템플릿은 `{{변수명}}` 형식으로 변수 자리를 표시한다.

| 변수명 | 사용 위치 | 타입 | 설명 |
|--------|----------|------|------|
| `{{issueNumber}}` | 전체 | number | Issue 번호 |
| `{{issueTitle}}` | 전체 | string | Issue 제목 |
| `{{issueBody}}` | plan, implement-phase | string | Issue 본문 (마크다운) |
| `{{baseBranch}}` | plan | string | 베이스 브랜치명 |
| `{{repository}}` | plan | string | "owner/repo" 형식 |
| `{{currentPhase}}` | implement-phase, fix-phase-error | number | 현재 phase 번호 |
| `{{totalPhases}}` | implement-phase | number | 전체 phase 수 |
| `{{plan}}` | implement-phase, review-*, pr-body | string | 구현 계획 마크다운 |
| `{{phaseTitle}}` | implement-phase | string | 현재 phase 제목 |
| `{{phaseDescription}}` | implement-phase | string | 현재 phase 상세 설명 |
| `{{errorSummary}}` | fix-phase-error, fix-final-validation | string | 오류 로그 요약 |
| `{{reviewRound}}` | review-* | number | 리뷰 라운드 번호 |
| `{{focus}}` | review-* | string | 리뷰 초점 영역 |

### 템플릿 예시: `plan.md`

```markdown
# 구현 계획 생성

## 대상 Issue
- Issue: #{{issueNumber}}
- 제목: {{issueTitle}}
- Repository: {{repository}}
- Base Branch: {{baseBranch}}

## Issue 내용
{{issueBody}}

## 지시사항

위 Issue의 요구사항을 분석하고, 구현 계획을 작성하라.

### 계획 형식

반드시 아래 형식으로 작성할 것:

```
## 요약
(전체 구현의 1-2문장 요약)

## Phase 1: (제목)
- 설명: (이 phase에서 구현할 내용)
- 예상 파일: (생성/수정할 파일 목록)
- 커밋 수: (예상 커밋 수)

## Phase 2: (제목)
...
```

### 규칙
1. 각 Phase는 독립적으로 검증 가능해야 한다 (typecheck, lint, test 통과).
2. Phase는 수직으로 분할하라: 하나의 기능을 완성하는 최소 단위.
3. Phase 수는 2-6개 사이로 유지하라.
4. 기존 코드를 먼저 탐색한 후 계획을 작성하라.
```

---

## 4. 설정 파일

### 4.1 `package.json`

```json
{
  "name": "ai-quartermaster",
  "version": "0.1.0",
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.0.0",
    "@hono/node-server": "^1.0.0",
    "simple-git": "^3.0.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/uuid": "^10.0.0",
    "eslint": "^9.0.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

### 4.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

### 4.3 `tsup.config.ts`

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: true,
});
```

### 4.4 `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/types/**"],
    },
  },
});
```

### 4.5 `.env.example`

```bash
# 서버
PORT=3000

# GitHub
WEBHOOK_SECRET=your-webhook-secret-here
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
ALLOWED_REPOS=owner/repo1,owner/repo2

# Git
GIT_REPO_PATH=/path/to/local/repo

# Claude CLI
CLAUDE_MODEL=sonnet

# Job 설정
MAX_CONCURRENT_JOBS=1
JOB_TIMEOUT_MS=1800000

# Worktree
WORKTREE_ROOT=/tmp/ai-quartermaster/worktrees

# 로깅
LOG_LEVEL=info
```

### 4.6 `.gitignore`

```gitignore
# Dependencies
node_modules/

# Build
dist/

# Environment
.env
.env.*
!.env.example

# Runtime
logs/
data/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Test coverage
coverage/
```

---

## 5. Worktree 루트 규칙

Worktree는 프로젝트 외부에 생성하여 메인 체크아웃을 오염하지 않는다.

```
/tmp/ai-quartermaster/
├── worktrees/                        # 활성 worktree 디렉토리
│   ├── {jobId-1}/                    # Job 1의 worktree
│   │   ├── .git                      # (worktree용 .git 파일, 디렉토리 아님)
│   │   ├── .ai-plan.md              # Claude가 생성한 구현 계획
│   │   ├── src/
│   │   ├── package.json
│   │   └── ...
│   └── {jobId-2}/                    # Job 2의 worktree
│       └── ...
│
└── temp/                             # 임시 파일 (프롬프트 렌더링 등)
    └── ...
```

### Worktree 생명주기 요약

| 시점 | 동작 | 경로 |
|------|------|------|
| `WORKTREE_CREATED` 진입 | `git worktree add` | `/tmp/ai-quartermaster/worktrees/{jobId}` |
| `PHASE_IN_PROGRESS` ~ `DRAFT_PR_CREATED` | worktree 내부에서 모든 작업 수행 | 동일 |
| `DONE` | `git worktree remove --force` | 경로 삭제됨 |
| `FAILED` | `git worktree remove --force` | 경로 삭제됨 |
| 서버 재시작 시 | `git worktree prune`으로 고아 worktree 정리 | - |

---

## 6. 런타임 아티팩트

### 6.1 로그 구조

```
logs/
├── app.log                           # 전체 애플리케이션 로그 (회전: 일별, 7일 보존)
├── failures/
│   └── {jobId}.json                  # 실패 상세 (30일 보존)
└── jobs/
    └── {jobId}/
        ├── pipeline.log              # 상태 전이 이력
        ├── claude-plan.log           # Claude CLI 계획 생성 출력
        ├── claude-phase-1.log        # Claude CLI Phase 1 출력
        ├── claude-phase-2.log        # Claude CLI Phase 2 출력
        ├── claude-review-1.log       # Claude CLI 리뷰 라운드 1 출력
        ├── claude-review-2.log       # Claude CLI 리뷰 라운드 2 출력
        ├── claude-review-3.log       # Claude CLI 리뷰 라운드 3 출력
        ├── claude-simplify.log       # Claude CLI 단순화 출력
        ├── verify-phase-1.log        # Phase 1 검증 결과
        ├── verify-phase-2.log        # Phase 2 검증 결과
        ├── verify-final.log          # 최종 검증 결과
        └── metadata.json             # Job 메타데이터 (시작 시간, 종료 시간, 결과)
```

### 6.2 Job 메타데이터 형식

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "issueNumber": 42,
  "repository": "owner/repo",
  "branchName": "aq/42-add-user-login",
  "startedAt": "2026-03-22T10:00:00.000Z",
  "completedAt": "2026-03-22T10:25:30.000Z",
  "durationMs": 1530000,
  "result": "DONE",
  "phases": {
    "total": 3,
    "completed": 3,
    "retries": { "phase-2": 1 }
  },
  "reviews": {
    "rounds": 3,
    "changesPerRound": [5, 3, 1]
  },
  "pr": {
    "number": 87,
    "url": "https://github.com/owner/repo/pull/87"
  },
  "claudeInvocations": 8,
  "totalClaudeTimeMs": 980000
}
```

---

## 7. 진입점 (`src/index.ts`) 구조

```typescript
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp } from "./webhook/server.js";
import { registerRoutes } from "./webhook/routes.js";
import { JobDispatcher } from "./queue/dispatcher.js";
import { StateStore } from "./queue/state-store.js";
import { PipelineRunner } from "./pipeline/runner.js";
import { GitManager } from "./git/git-manager.js";
import { ClaudeCLIBridge } from "./claude/bridge.js";
import { Verifier } from "./verify/verifier.js";
import { GitHubAPI } from "./github/api.js";
import { createLogger } from "./logger/logger.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger();

  // 컴포넌트 초기화
  const stateStore = new StateStore(config.dataDir);
  const gitManager = new GitManager(config.gitRepoPath, config.worktreeRoot);
  const claudeBridge = new ClaudeCLIBridge(config.claudeModel);
  const verifier = new Verifier();
  const githubAPI = new GitHubAPI();

  // 파이프라인 러너
  const pipelineRunner = new PipelineRunner(
    gitManager, claudeBridge, verifier, githubAPI, stateStore
  );

  // Job 디스패처
  const dispatcher = new JobDispatcher(pipelineRunner, {
    maxConcurrentJobs: config.maxConcurrentJobs,
    jobTimeoutMs: config.jobTimeoutMs,
  });

  // HTTP 서버
  const app = createApp();
  registerRoutes(app, dispatcher);

  // 시작 시 고아 worktree 정리
  await gitManager.pruneWorktrees();

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info(`AI 병참부 서버 시작: http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error("서버 시작 실패:", err);
  process.exit(1);
});
```
