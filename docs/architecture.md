# AI 병참부 - 아키텍처 설계서

## 1. 시스템 개요

AI 병참부는 GitHub Issue를 입력으로 받아 Claude CLI 기반 자동 구현 파이프라인을 실행하는 시스템이다.
사람은 Issue를 작성하고 최종 Draft PR을 승인/머지하는 역할만 담당하며, 그 사이의 모든 과정은 자동화된다.

### 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **작업 디렉토리 오염 금지** | AI는 현재 작업 디렉토리(메인 체크아웃)를 절대 수정하지 않는다. 모든 작업은 독립 worktree에서 수행한다. |
| **베이스 브랜치 기반 분기** | 항상 Issue에 지정된 base branch(기본: `main`)에서 분기한다. |
| **계획 선행** | 코드 작성 전 반드시 구현 계획을 생성한다. 계획 없이 코드를 작성하지 않는다. |
| **수직 분할** | 기능을 phase 단위로 분할하고, 각 phase는 독립적으로 검증 가능한 소규모 커밋으로 구성한다. |
| **단계별 검증** | 매 phase 완료 후 테스트/린트/빌드를 실행한다. |
| **Draft PR까지만 자동화** | 자동으로 Draft PR을 생성하되, 머지는 반드시 사람이 수행한다. |

---

## 2. 전체 컴포넌트 구성도

```
                          GitHub
                            |
                            | Webhook (issue event)
                            v
                 +---------------------+
                 |  Webhook Receiver    |
                 |  (Hono HTTP Server)  |
                 +---------------------+
                            |
                            | IssueEvent 전달
                            v
                 +---------------------+
                 |   Job Dispatcher     |
                 |   (Queue Manager)    |
                 +---------------------+
                            |
                            | Job 할당
                            v
                 +---------------------+
                 |   Pipeline Runner    |
                 |   (State Machine)    |
                 +---------------------+
                   |       |        |
          +--------+   +---+---+   +--------+
          v            v       v            v
    +-----------+ +---------+ +----------+ +----------+
    | Git       | | Claude  | | Verifier | | GitHub   |
    | Manager   | | CLI     | | (test/   | | API      |
    | (simple-  | | Bridge  | |  lint/   | | (gh CLI) |
    |  git)     | |         | |  build)  | |          |
    +-----------+ +---------+ +----------+ +----------+
          |            |           |             |
          v            v           v             v
    +-----------+ +---------+ +----------+ +----------+
    | Worktree  | | Prompt  | | 검증     | | Draft PR |
    | 파일시스템 | | 템플릿  | | 결과     | | 생성     |
    +-----------+ +---------+ +----------+ +----------+
```

---

## 3. 컴포넌트 상세 설계

### 3.1 Webhook Receiver

GitHub에서 전송하는 Issue 이벤트를 수신하는 HTTP 서버이다.

#### API 설계

| 항목 | 값 |
|------|-----|
| **프레임워크** | Hono |
| **포트** | `3000` (환경변수 `PORT`로 변경 가능) |
| **경로** | `POST /webhook/github` |
| **인증** | GitHub Webhook Secret (`WEBHOOK_SECRET`) HMAC-SHA256 검증 |

#### 요청 처리 흐름

```typescript
// POST /webhook/github
// Headers:
//   X-GitHub-Event: "issues"
//   X-Hub-Signature-256: "sha256=..."
//   X-GitHub-Delivery: "<delivery-id>"

interface GitHubIssueEvent {
  action: "opened" | "edited" | "labeled";
  issue: {
    number: number;
    title: string;
    body: string;
    labels: Array<{ name: string }>;
    user: { login: string };
  };
  repository: {
    full_name: string;        // "owner/repo"
    default_branch: string;   // "main"
    clone_url: string;
  };
}
```

#### 수신 조건 필터

```typescript
// 다음 조건을 모두 만족해야 Job으로 전달
const TRIGGER_LABEL = "ai-implement";

function shouldProcess(event: GitHubIssueEvent): boolean {
  // 1. action이 "opened" 또는 "labeled"
  if (event.action !== "opened" && event.action !== "labeled") return false;

  // 2. "ai-implement" 라벨 존재
  if (!event.issue.labels.some(l => l.name === TRIGGER_LABEL)) return false;

  // 3. 허용된 repository인지 확인
  if (!ALLOWED_REPOS.includes(event.repository.full_name)) return false;

  // 4. 중복 실행 방지: 동일 issue에 대한 진행 중 Job이 없어야 함
  if (jobQueue.hasActiveJob(event.issue.number)) return false;

  return true;
}
```

#### 응답 규격

| 상황 | 상태코드 | 응답 |
|------|----------|------|
| 성공적으로 큐에 등록 | `202 Accepted` | `{ "jobId": "...", "issueNumber": 42 }` |
| 서명 검증 실패 | `401 Unauthorized` | `{ "error": "Invalid signature" }` |
| 필터 조건 미충족 | `200 OK` | `{ "skipped": true, "reason": "..." }` |
| 내부 오류 | `500 Internal Server Error` | `{ "error": "..." }` |

---

### 3.2 Job Dispatcher (Queue Manager)

동시 실행을 제한하고 Job의 순서를 관리한다.

```typescript
interface JobConfig {
  maxConcurrentJobs: number;  // 기본값: 1 (순차 실행)
  jobTimeoutMs: number;       // 기본값: 30분 (1800000)
}

interface Job {
  id: string;                 // UUID v4
  issueNumber: number;
  repository: string;         // "owner/repo"
  baseBranch: string;
  issueTitle: string;
  issueBody: string;
  status: PipelineState;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
  retryCount: number;
}
```

#### 큐 동작 방식

| 동작 | 설명 |
|------|------|
| **등록** | Webhook Receiver가 `dispatch(event)` 호출 시 Job 생성 후 큐에 추가 |
| **실행** | 큐에서 FIFO로 꺼내 Pipeline Runner에 전달. `maxConcurrentJobs` 이하만 동시 실행 |
| **타임아웃** | `jobTimeoutMs` 초과 시 강제 종료, 상태를 `FAILED`로 전이 |
| **중복 방지** | 동일 `issueNumber`에 대해 `DONE`/`FAILED`가 아닌 Job이 존재하면 등록 거부 |

---

### 3.3 Pipeline Runner (State Machine)

핵심 오케스트레이터. 하나의 Job을 받아 상태 머신에 따라 단계별로 실행한다.

```typescript
class PipelineRunner {
  constructor(
    private gitManager: GitManager,
    private claudeBridge: ClaudeCLIBridge,
    private verifier: Verifier,
    private githubAPI: GitHubAPI,
    private stateStore: StateStore,
  ) {}

  async run(job: Job): Promise<void> {
    // RECEIVED → VALIDATED → BASE_SYNCED → BRANCH_CREATED
    // → WORKTREE_CREATED → PLAN_GENERATED
    // → PHASE_IN_PROGRESS (loop) → REVIEWING (3 rounds)
    // → SIMPLIFYING → FINAL_VALIDATING → DRAFT_PR_CREATED → DONE
  }
}
```

상태 전이의 상세 내용은 `docs/state-machine.md`를 참조한다.

---

### 3.4 Git Manager

모든 Git 작업을 캡슐화하는 컴포넌트이다. `simple-git` 라이브러리를 사용한다.

#### 브랜치 네이밍 규칙

```
ax/{issueNumber}-{slug}

예시:
  Issue #42 "사용자 로그인 기능 추가"
  → ax/42-add-user-login
```

#### slug 생성 규칙

```typescript
function createSlug(issueTitle: string): string {
  return issueTitle
    .toLowerCase()
    .replace(/[가-힣]+/g, (match) => slugifyKorean(match))  // 한글 → 영문 변환 (선택)
    .replace(/[^a-z0-9]+/g, "-")    // 특수문자 → 하이픈
    .replace(/^-|-$/g, "")           // 양끝 하이픈 제거
    .slice(0, 40);                   // 최대 40자
}
```

#### Worktree 생명주기

```
[생성]
  1. git fetch origin
  2. git checkout -B ax/{n}-{slug} origin/{baseBranch}
  3. git worktree add /tmp/ai-quartermaster/worktrees/{jobId} ax/{n}-{slug}

[사용]
  - 모든 Claude CLI 작업의 cwd를 worktree 경로로 지정
  - 커밋, 테스트, 빌드 모두 worktree 내부에서 실행

[정리]
  - Pipeline 완료(DONE) 또는 실패(FAILED) 후:
    1. git worktree remove /tmp/ai-quartermaster/worktrees/{jobId} --force
    2. 성공 시 브랜치 유지 (PR용)
    3. 실패 시 브랜치 삭제: git branch -D ax/{n}-{slug}
```

#### Git Manager 인터페이스

```typescript
interface GitManager {
  // 원격 동기화
  fetchOrigin(): Promise<void>;
  ensureBranchUpToDate(baseBranch: string): Promise<void>;

  // 브랜치 관리
  createWorkBranch(issueNumber: number, slug: string, baseBranch: string): Promise<string>;
  deleteBranch(branchName: string): Promise<void>;
  branchExists(branchName: string): Promise<boolean>;

  // Worktree 관리
  createWorktree(jobId: string, branchName: string): Promise<string>;  // worktree 경로 반환
  removeWorktree(jobId: string): Promise<void>;
  getWorktreePath(jobId: string): string;

  // Worktree 내 작업
  commitAll(worktreePath: string, message: string): Promise<string>;  // commit SHA 반환
  push(worktreePath: string, branchName: string): Promise<void>;
  getStatus(worktreePath: string): Promise<GitStatus>;
  getDiff(worktreePath: string): Promise<string>;
}
```

#### Worktree 경로 규칙

```
/tmp/ai-quartermaster/
  └── worktrees/
      └── {jobId}/          ← 각 Job별 독립 worktree
          ├── src/
          ├── package.json
          └── ...
```

---

### 3.5 Claude CLI Bridge

Claude CLI를 subprocess로 호출하여 AI 작업을 수행하는 컴포넌트이다.

#### 호출 방식

```typescript
import { spawn } from "node:child_process";

interface ClaudeCLIOptions {
  cwd: string;              // worktree 경로
  prompt: string;           // 전달할 프롬프트
  maxTurns?: number;        // --max-turns (기본: 50)
  allowedTools?: string[];  // --allowedTools
  timeout?: number;         // ms (기본: 600000 = 10분)
  model?: string;           // --model (기본: 환경변수 CLAUDE_MODEL)
}

interface ClaudeCLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}
```

#### 실행 명령 구성

```typescript
function buildClaudeCommand(options: ClaudeCLIOptions): string[] {
  const args = [
    "claude",
    "--print",                           // 비대화형 모드, 결과만 출력
    "--max-turns", String(options.maxTurns ?? 50),
    "--output-format", "json",           // 구조화된 출력
  ];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.allowedTools?.length) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }

  // 프롬프트는 stdin으로 전달
  return args;
}

async function invokeClaude(options: ClaudeCLIOptions): Promise<ClaudeCLIResult> {
  const args = buildClaudeCommand(options);
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const proc = spawn(args[0], args.slice(1), {
      cwd: options.cwd,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    // 프롬프트를 stdin으로 전달
    proc.stdin.write(options.prompt);
    proc.stdin.end();

    // 타임아웃 처리
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Claude CLI timeout after ${options.timeout}ms`));
    }, options.timeout ?? 600000);

    proc.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 1,
        durationMs: Date.now() - startTime,
      });
    });
  });
}
```

#### 각 단계별 Claude CLI 호출 구성

| 단계 | maxTurns | allowedTools | timeout | 비고 |
|------|----------|-------------|---------|------|
| **계획 생성** | 10 | `Read`, `Glob`, `Grep`, `Bash(read-only)` | 5분 | 코드 수정 도구 차단 |
| **Phase 구현** | 50 | `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash` | 10분 | 전체 도구 허용 |
| **리뷰 (각 라운드)** | 20 | `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash` | 5분 | 수정 가능 |
| **단순화** | 15 | `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash` | 5분 | 불필요 코드 제거 |

#### 프롬프트 전달 방식

프롬프트는 템플릿 파일에서 로드 후 변수를 치환하여 stdin으로 전달한다.

```typescript
interface PromptContext {
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  baseBranch: string;
  repository: string;
  currentPhase?: number;
  totalPhases?: number;
  plan?: string;
  previousReviewFeedback?: string;
  reviewRound?: number;
}

function renderPrompt(templateName: string, context: PromptContext): string {
  const templatePath = path.join(PROMPTS_DIR, `${templateName}.md`);
  let template = fs.readFileSync(templatePath, "utf-8");

  for (const [key, value] of Object.entries(context)) {
    template = template.replaceAll(`{{${key}}}`, String(value ?? ""));
  }

  return template;
}
```

---

### 3.6 Verifier

각 phase 완료 후 그리고 최종 검증 단계에서 코드 품질을 확인한다.

```typescript
interface VerificationResult {
  passed: boolean;
  checks: Array<{
    name: string;           // "typecheck" | "lint" | "test" | "build"
    passed: boolean;
    output: string;
    durationMs: number;
  }>;
}

interface Verifier {
  // Phase별 검증 (빠른 피드백)
  verifyPhase(worktreePath: string): Promise<VerificationResult>;

  // 최종 검증 (전체 suite)
  verifyFinal(worktreePath: string): Promise<VerificationResult>;
}
```

#### 검증 항목

| 검증 | 명령어 | Phase별 | 최종 | 실패 시 |
|------|--------|---------|------|---------|
| TypeScript 타입 체크 | `npx tsc --noEmit` | O | O | PHASE_FAILED |
| ESLint | `npx eslint . --max-warnings 0` | O | O | PHASE_FAILED |
| 단위 테스트 | `npm test` | O | O | PHASE_FAILED |
| 빌드 | `npm run build` | X | O | FINAL_VALIDATING 실패 |
| 민감 파일 검사 | 커스텀 체크 | O | O | PHASE_FAILED |

#### 민감 파일 검사

```typescript
const FORBIDDEN_PATTERNS = [
  /\.env$/,
  /\.env\..+$/,
  /credentials/i,
  /secret/i,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
];

const FORBIDDEN_CONTENT_PATTERNS = [
  /(?:password|secret|token|api_key)\s*[:=]\s*["'][^"']+["']/i,
  /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
];

function checkSensitiveFiles(worktreePath: string, diff: string): string[] {
  const violations: string[] = [];

  // 변경된 파일명 검사
  for (const file of getChangedFiles(diff)) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(file)) {
        violations.push(`금지된 파일 변경 감지: ${file}`);
      }
    }
  }

  // 변경 내용 검사
  for (const pattern of FORBIDDEN_CONTENT_PATTERNS) {
    if (pattern.test(diff)) {
      violations.push(`민감한 내용 패턴 감지: ${pattern.source}`);
    }
  }

  return violations;
}
```

---

### 3.7 GitHub API (gh CLI)

`gh` CLI를 통해 GitHub과 상호작용한다.

```typescript
interface GitHubAPI {
  // PR 생성
  createDraftPR(params: {
    repo: string;           // "owner/repo"
    head: string;           // "ax/42-add-user-login"
    base: string;           // "main"
    title: string;
    body: string;
    draft: true;
  }): Promise<{ number: number; url: string }>;

  // Issue에 코멘트 추가
  addIssueComment(params: {
    repo: string;
    issueNumber: number;
    body: string;
  }): Promise<void>;

  // Issue 라벨 관리
  addLabel(repo: string, issueNumber: number, label: string): Promise<void>;
  removeLabel(repo: string, issueNumber: number, label: string): Promise<void>;
}
```

#### gh CLI 호출 예시

```typescript
// Draft PR 생성
async function createDraftPR(params: CreatePRParams): Promise<PRResult> {
  const args = [
    "gh", "pr", "create",
    "--repo", params.repo,
    "--head", params.head,
    "--base", params.base,
    "--title", params.title,
    "--body", params.body,
    "--draft",
    "--json", "number,url",
  ];

  const result = await execCommand(args);
  return JSON.parse(result.stdout);
}

// Issue 코멘트
async function addIssueComment(params: CommentParams): Promise<void> {
  await execCommand([
    "gh", "issue", "comment",
    String(params.issueNumber),
    "--repo", params.repo,
    "--body", params.body,
  ]);
}
```

#### PR 본문 템플릿

```markdown
## 자동 구현 PR

> Issue #{{issueNumber}}: {{issueTitle}}
> 이 PR은 AI 병참부에 의해 자동 생성되었습니다.

### 구현 계획

{{plan}}

### Phase 요약

{{phaseSummary}}

### 검증 결과

- [x] TypeScript 타입 체크 통과
- [x] ESLint 통과
- [x] 단위 테스트 통과
- [x] 빌드 성공
- [x] 3회 리뷰 완료
- [x] 코드 단순화 완료

### 리뷰어 참고사항

이 PR은 **Draft** 상태입니다. 내용을 검토한 후 승인/머지해 주세요.

---
*Generated by AI 병참부 v{{version}}*
```

---

## 4. Review Pipeline 상세

3라운드 리뷰 + 단순화 과정을 거쳐 코드 품질을 보장한다.

### 4.1 리뷰 라운드 구성

| 라운드 | 초점 | 프롬프트 지시 |
|--------|------|--------------|
| **1라운드: 정확성** | 기능 요구사항 충족 여부, 버그, 엣지 케이스 | "Issue 요구사항을 모두 충족하는지 검증하라. 누락된 엣지 케이스와 버그를 찾아 수정하라." |
| **2라운드: 품질** | 코드 품질, 네이밍, 구조, 에러 처리 | "코드 품질을 개선하라. 네이밍, 함수 분리, 에러 처리, 타입 안전성을 점검하라." |
| **3라운드: 통합** | 기존 코드와의 일관성, 부작용 | "기존 코드베이스와의 일관성을 확인하라. import 경로, 네이밍 컨벤션, 패턴 일치 여부를 점검하라." |

### 4.2 각 라운드 실행 흐름

```
라운드 N 시작
  │
  ├── Claude CLI 호출 (리뷰 프롬프트 + 이전 라운드 피드백)
  │     cwd: worktree 경로
  │     Claude가 코드를 읽고, 문제를 찾고, 직접 수정
  │
  ├── git diff로 변경사항 캡처
  │
  ├── 변경사항이 있으면 커밋
  │     메시지: "review(round-{N}): {요약}"
  │
  ├── Verifier 실행 (typecheck + lint + test)
  │     실패 시 → Claude에게 오류 전달하여 수정 요청 (최대 2회 재시도)
  │
  └── 다음 라운드로 진행
```

### 4.3 Simplify 단계

```
단순화 시작
  │
  ├── Claude CLI 호출 (단순화 프롬프트)
  │     지시: "불필요한 추상화를 제거하라. 사용하지 않는 코드를 삭제하라.
  │            console.log/debugger/TODO/HACK을 제거하라.
  │            복잡한 로직을 단순화하되 기능은 유지하라."
  │
  ├── 변경사항 커밋
  │     메시지: "simplify: {요약}"
  │
  └── Verifier 실행
        실패 시 → 변경 revert, 단순화 건너뛰기
```

---

## 5. 실패 복구 전략

### 5.1 단계별 실패 처리

| 상태 | 실패 원인 | 복구 전략 | 최대 재시도 |
|------|----------|----------|------------|
| `VALIDATED` | Issue 본문 파싱 실패 | Issue에 코멘트로 형식 안내, FAILED 전이 | 0 |
| `BASE_SYNCED` | 네트워크 오류, 원격 저장소 접근 불가 | 지수 백오프 재시도 | 3 |
| `BRANCH_CREATED` | 브랜치명 충돌 | 접미사 추가 (`-2`, `-3`), 기존 브랜치가 merged면 삭제 후 재생성 | 2 |
| `WORKTREE_CREATED` | 디스크 공간 부족, 경로 충돌 | 고아 worktree 정리 후 재시도 | 2 |
| `PLAN_GENERATED` | Claude CLI 오류, 타임아웃 | 재시도 | 2 |
| `PHASE_IN_PROGRESS` | 테스트 실패, 빌드 실패 | Claude에게 오류 전달하여 수정 요청 | 3 (phase당) |
| `REVIEWING` | Claude CLI 오류 | 해당 라운드 재시도 | 2 (라운드당) |
| `SIMPLIFYING` | 단순화 후 테스트 실패 | 변경 revert, 단순화 건너뛰기 | 1 |
| `FINAL_VALIDATING` | 빌드/테스트 실패 | Claude에게 전체 오류 로그 전달하여 수정 | 2 |
| `DRAFT_PR_CREATED` | gh CLI 오류, 권한 부족 | 재시도, 실패 시 FAILED + 코멘트 | 3 |

### 5.2 전역 실패 처리

```typescript
async function handleGlobalFailure(job: Job, error: Error): Promise<void> {
  // 1. 상태를 FAILED로 전이
  await stateStore.transition(job.id, "FAILED", { error: error.message });

  // 2. Issue에 실패 코멘트 작성
  await githubAPI.addIssueComment({
    repo: job.repository,
    issueNumber: job.issueNumber,
    body: formatFailureComment(job, error),
  });

  // 3. "ai-failed" 라벨 추가
  await githubAPI.addLabel(job.repository, job.issueNumber, "ai-failed");

  // 4. Worktree 정리
  await gitManager.removeWorktree(job.id);

  // 5. 실패 로그 저장
  await logStore.saveFailureLog(job.id, {
    state: job.status,
    error: error.message,
    stack: error.stack,
    timestamp: new Date(),
  });
}
```

### 5.3 실패 코멘트 형식

```markdown
## AI 병참부 - 구현 실패 보고

**상태**: {{failedState}}
**오류**: {{errorMessage}}

### 실패 시점 정보
- 완료된 Phase: {{completedPhases}} / {{totalPhases}}
- 마지막 성공 상태: {{lastSuccessState}}
- 실행 시간: {{durationMinutes}}분

### 오류 로그 (마지막 500자)
```
{{truncatedErrorLog}}
```

### 다음 단계
- `ai-implement` 라벨을 다시 부여하면 처음부터 재시도합니다.
- Issue 내용을 수정한 후 라벨을 부여하면 수정된 내용으로 재시도합니다.

---
*AI 병참부 v{{version}}*
```

---

## 6. 보호장치 목록

### 6.1 Base Branch 보호

```typescript
const PROTECTED_BRANCHES = ["main", "master", "develop", "release/*"];

// 절대 보호 브랜치에 직접 push하지 않음
function validateBranch(branchName: string): void {
  for (const pattern of PROTECTED_BRANCHES) {
    if (minimatch(branchName, pattern)) {
      throw new SafeguardError(`보호 브랜치에 대한 직접 작업 금지: ${branchName}`);
    }
  }

  // ax/ 접두사 필수
  if (!branchName.startsWith("ax/")) {
    throw new SafeguardError(`브랜치명은 'ax/' 접두사 필수: ${branchName}`);
  }
}
```

### 6.2 허용 Repository

```typescript
// config.ts
export const ALLOWED_REPOS: string[] = [
  // 환경변수 ALLOWED_REPOS에서 로드 (쉼표 구분)
  // 예: "owner/repo1,owner/repo2"
];

// 빈 목록이면 모든 요청 거부 (화이트리스트 방식)
function isRepoAllowed(repoFullName: string): boolean {
  return ALLOWED_REPOS.includes(repoFullName);
}
```

### 6.3 브랜치명 충돌 처리

```typescript
async function resolvebranchConflict(
  branchName: string,
  issueNumber: number
): Promise<string> {
  if (!(await gitManager.branchExists(branchName))) {
    return branchName;
  }

  // 기존 브랜치가 이미 머지되었는지 확인
  const isMerged = await gitManager.isBranchMerged(branchName);
  if (isMerged) {
    await gitManager.deleteBranch(branchName);
    return branchName;
  }

  // 머지되지 않은 브랜치면 접미사 추가
  for (let suffix = 2; suffix <= 5; suffix++) {
    const candidate = `${branchName}-${suffix}`;
    if (!(await gitManager.branchExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`브랜치명 충돌 해소 불가: ${branchName}`);
}
```

### 6.4 테스트 실패 대응

```typescript
interface PhaseRetryPolicy {
  maxRetries: number;           // 3
  feedbackToAI: boolean;        // true: 오류 메시지를 Claude에게 전달
  revertOnMaxRetry: boolean;    // true: 최대 재시도 초과 시 해당 phase 변경 revert
}

async function handlePhaseFailure(
  worktreePath: string,
  phaseNumber: number,
  verificationResult: VerificationResult,
  retryCount: number,
  policy: PhaseRetryPolicy,
): Promise<"retry" | "fail"> {
  if (retryCount >= policy.maxRetries) {
    if (policy.revertOnMaxRetry) {
      await gitManager.revertLastCommit(worktreePath);
    }
    return "fail";
  }

  if (policy.feedbackToAI) {
    const errorSummary = verificationResult.checks
      .filter(c => !c.passed)
      .map(c => `[${c.name}] ${c.output}`)
      .join("\n\n");

    // Claude에게 오류를 전달하여 수정 요청
    await claudeBridge.invoke({
      cwd: worktreePath,
      prompt: renderPrompt("fix-phase-error", {
        phaseNumber,
        errorSummary,
      }),
    });
  }

  return "retry";
}
```

### 6.5 민감 경로 보호

```typescript
// AI가 수정해서는 안 되는 경로
const PROTECTED_PATHS = [
  ".github/workflows/",    // CI/CD 설정
  ".env",                  // 환경변수
  ".env.*",
  "*.pem",
  "*.key",
  "package-lock.json",     // 직접 수정 금지 (npm install로만 변경)
  "yarn.lock",
];

function validateChangedFiles(changedFiles: string[]): string[] {
  const violations: string[] = [];
  for (const file of changedFiles) {
    for (const pattern of PROTECTED_PATHS) {
      if (minimatch(file, pattern)) {
        violations.push(`보호 경로 수정 감지: ${file}`);
      }
    }
  }
  return violations;
}
```

### 6.6 허용 명령어 제한

```typescript
// Claude CLI에 전달하는 allowedTools로 제어
// Bash 도구의 경우 추가 제한 적용

const BANNED_BASH_PATTERNS = [
  /rm\s+-rf\s+\//,          // 루트 삭제 방지
  /git\s+push\s+.*--force/,  // force push 방지
  /git\s+push\s+origin\s+(main|master)/, // 보호 브랜치 직접 push 방지
  /curl.*\|.*sh/,            // 파이프 실행 방지
  /wget.*\|.*sh/,
  /npm\s+publish/,           // 패키지 배포 방지
  /sudo\s+/,                 // sudo 사용 방지
];
```

### 6.7 실패 로그 저장

```typescript
interface FailureLog {
  jobId: string;
  issueNumber: number;
  repository: string;
  state: PipelineState;
  error: string;
  stack?: string;
  claudeOutput?: string;     // Claude CLI의 마지막 출력
  verificationOutput?: string;
  timestamp: Date;
  duration: number;
}

// 로그 저장 경로: logs/failures/{jobId}.json
// 보존 기간: 30일 (cron으로 정리)
```

---

## 7. 환경변수 목록

| 변수명 | 필수 | 기본값 | 설명 |
|--------|------|--------|------|
| `PORT` | X | `3000` | Webhook 서버 포트 |
| `WEBHOOK_SECRET` | O | - | GitHub Webhook Secret |
| `ALLOWED_REPOS` | O | - | 허용 Repository 목록 (쉼표 구분) |
| `CLAUDE_MODEL` | X | `sonnet` | Claude CLI 모델 |
| `MAX_CONCURRENT_JOBS` | X | `1` | 최대 동시 실행 Job 수 |
| `JOB_TIMEOUT_MS` | X | `1800000` | Job 타임아웃 (ms) |
| `WORKTREE_ROOT` | X | `/tmp/ai-quartermaster/worktrees` | Worktree 루트 경로 |
| `LOG_LEVEL` | X | `info` | 로그 레벨 (debug/info/warn/error) |
| `GITHUB_TOKEN` | O | - | gh CLI 인증 토큰 |
| `GIT_REPO_PATH` | O | - | 로컬 Git 저장소 경로 (메인 체크아웃) |

---

## 8. 기술 스택 요약

| 영역 | 기술 | 버전 요구사항 |
|------|------|-------------|
| 런타임 | Node.js | >= 20.x |
| 언어 | TypeScript | >= 5.x |
| HTTP 서버 | Hono | >= 4.x |
| Git 라이브러리 | simple-git | >= 3.x |
| AI CLI | Claude CLI | 최신 |
| GitHub CLI | gh | >= 2.x |
| 패키지 매니저 | npm | >= 10.x |
| 빌드 도구 | tsup | >= 8.x |
| 테스트 | vitest | >= 2.x |
| 린트 | eslint | >= 9.x (flat config) |
