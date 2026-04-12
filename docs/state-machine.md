# AI 병참부 - 상태 전이 흐름도

## 1. 상태 목록

| 상태 | 코드 | 설명 |
|------|------|------|
| 접수됨 | `RECEIVED` | Issue 이벤트 수신, Job 생성 완료 |
| 검증됨 | `VALIDATED` | Issue 내용 파싱 및 유효성 검증 완료 |
| 베이스 동기화 | `BASE_SYNCED` | 원격 저장소 fetch 및 base branch 동기화 완료 |
| 브랜치 생성됨 | `BRANCH_CREATED` | 작업 브랜치 `aq/{n}-{slug}` 생성 완료 |
| 워크트리 생성됨 | `WORKTREE_CREATED` | 격리된 worktree 디렉토리 생성 완료 |
| 계획 생성됨 | `PLAN_GENERATED` | Claude가 구현 계획(phase 분할 포함) 생성 완료 |
| Phase 진행 중 | `PHASE_IN_PROGRESS` | 현재 phase 구현 및 검증 진행 중 (루프) |
| Phase 실패 | `PHASE_FAILED` | 현재 phase의 검증 실패 (재시도 대기) |
| 리뷰 중 | `REVIEWING` | 3라운드 리뷰 진행 중 |
| 단순화 중 | `SIMPLIFYING` | 불필요 코드 제거 및 단순화 진행 중 |
| 최종 검증 중 | `FINAL_VALIDATING` | 전체 빌드/테스트/린트 최종 검증 |
| Draft PR 생성됨 | `DRAFT_PR_CREATED` | GitHub Draft PR 생성 완료 |
| 완료 | `DONE` | 전체 파이프라인 성공 완료 |
| 실패 | `FAILED` | 복구 불가능한 실패, 파이프라인 종료 |

---

## 2. 전체 상태 전이도

```
                        ┌─────────────┐
                        │  RECEIVED   │
                        └──────┬──────┘
                               │ Issue 유효성 검증
                               ▼
                        ┌─────────────┐
                   ┌───>│  VALIDATED  │
                   │    └──────┬──────┘
                   │           │ git fetch origin
                   │           ▼
                   │    ┌─────────────┐
                   │    │ BASE_SYNCED │
                   │    └──────┬──────┘
                   │           │ 작업 브랜치 생성
                   │           ▼
                   │    ┌──────────────────┐
                   │    │ BRANCH_CREATED   │
                   │    └──────┬───────────┘
                   │           │ worktree 생성
                   │           ▼
                   │    ┌───────────────────┐
                   │    │ WORKTREE_CREATED  │
                   │    └──────┬────────────┘
                   │           │ Claude CLI: 계획 생성
                   │           ▼
                   │    ┌──────────────────┐
                   │    │ PLAN_GENERATED   │
                   │    └──────┬───────────┘
                   │           │ Phase 1 시작
                   │           ▼
                   │    ┌─────────────────────┐
                   │    │ PHASE_IN_PROGRESS   │◄──────────┐
                   │    │ (phase N / total M) │           │
                   │    └──────┬──────────────┘           │
                   │           │                          │
                   │      ┌────┴────┐                     │
                   │      │검증 성공?│                     │
                   │      └────┬────┘                     │
                   │       예/    \아니오                  │
                   │      /        \                      │
                   │     ▼          ▼                     │
                   │  ┌──────┐  ┌──────────────┐          │
                   │  │다음   │  │ PHASE_FAILED │          │
                   │  │phase? │  └──────┬───────┘          │
                   │  └──┬───┘    재시도?│                 │
                   │  예/ \아니오  예/  \아니오            │
                   │  /    \      /      \                │
                   │ ▼      │    ▼        ▼               │
                   │ 다음   │  수정 후   FAILED            │
                   │ phase──┼──재검증────>│               │
                   │        │             │               │
                   │        ▼             │               │
                   │ ┌─────────────┐      │               │
                   │ │  REVIEWING  │      │               │
                   │ │ (3 rounds)  │      │               │
                   │ └──────┬──────┘      │               │
                   │        │             │               │
                   │        ▼             │               │
                   │ ┌──────────────┐     │               │
                   │ │ SIMPLIFYING  │     │               │
                   │ └──────┬───────┘     │               │
                   │        │             │               │
                   │        ▼             │               │
                   │ ┌───────────────────┐│               │
                   │ │ FINAL_VALIDATING  ││               │
                   │ └──────┬────────────┘│               │
                   │   성공/ \실패        │               │
                   │   /     \            │               │
                   │  ▼       ▼           │               │
                   │ ┌────────────────┐   │               │
                   │ │DRAFT_PR_CREATED│   │               │
                   │ └──────┬─────────┘   │               │
                   │        │             │               │
                   │        ▼             │               │
                   │    ┌────────┐   ┌────────┐           │
                   │    │  DONE  │   │ FAILED │           │
                   │    └────────┘   └────────┘           │
                   │                                      │
                   └────── (라벨 재부여 시 재시도) ────────┘
```

---

## 3. 상태별 상세 명세

### 3.1 RECEIVED

| 항목 | 내용 |
|------|------|
| **진입 조건** | Webhook Receiver가 GitHub Issue 이벤트를 수신하고 필터 조건을 통과함 |
| **실행 액션** | 1. Job 객체 생성 (UUID, issueNumber, repository, baseBranch, issueTitle, issueBody 저장) <br> 2. Job을 큐에 등록 <br> 3. Issue에 "접수 완료" 코멘트 작성 |
| **성공 시 다음 상태** | `VALIDATED` |
| **실패 조건** | Job 생성 불가 (메모리 부족 등 시스템 오류) |
| **실패 시 다음 상태** | `FAILED` |

```typescript
// 진입 시 실행 코드
async function handleReceived(job: Job): Promise<void> {
  await githubAPI.addIssueComment({
    repo: job.repository,
    issueNumber: job.issueNumber,
    body: `## AI 병참부 - 접수 완료\n\nIssue #${job.issueNumber}을 접수했습니다. 자동 구현을 시작합니다.\n\nJob ID: \`${job.id}\``,
  });

  // 미구현: "ai-in-progress" 라벨 추가 (코드에 구현되지 않음)
}
```

---

### 3.2 VALIDATED

| 항목 | 내용 |
|------|------|
| **진입 조건** | `RECEIVED` 상태에서 Job 생성 완료 |
| **실행 액션** | 1. Issue 본문 파싱 (제목, 설명, 요구사항 추출) <br> 2. 필수 정보 존재 여부 확인 (제목 비어있지 않음, 본문 최소 10자) <br> 3. base branch 결정 (Issue 본문에서 `base:` 태그 파싱, 없으면 repository 기본 브랜치) <br> 4. Repository가 허용 목록에 있는지 재확인 |
| **성공 시 다음 상태** | `BASE_SYNCED` |
| **실패 조건** | Issue 본문이 비어있음, 필수 정보 누락, 허용되지 않은 repository |
| **실패 시 다음 상태** | `FAILED` (Issue에 형식 안내 코멘트 작성) |
| **재시도** | 없음 (Issue 내용 수정 후 라벨 재부여로 재시도) |

```typescript
// Base branch 결정 로직
function determineBaseBranch(issueBody: string, defaultBranch: string): string {
  // Issue 본문에서 "base: <branch>" 패턴 검색
  const match = issueBody.match(/^base:\s*(\S+)/m);
  if (match) {
    return match[1];
  }
  return defaultBranch;
}

// 유효성 검증
function validateIssue(job: Job): ValidationResult {
  const errors: string[] = [];

  if (!job.issueTitle || job.issueTitle.trim().length === 0) {
    errors.push("Issue 제목이 비어있습니다.");
  }

  if (!job.issueBody || job.issueBody.trim().length < 10) {
    errors.push("Issue 본문이 너무 짧습니다. 최소 10자 이상 작성해 주세요.");
  }

  return {
    valid: errors.length === 0,
    errors,
    baseBranch: determineBaseBranch(job.issueBody, job.baseBranch),
  };
}
```

---

### 3.3 BASE_SYNCED

| 항목 | 내용 |
|------|------|
| **진입 조건** | `VALIDATED` 상태에서 Issue 유효성 검증 통과 |
| **실행 액션** | 1. `git fetch origin` 실행 <br> 2. base branch가 원격에 존재하는지 확인 <br> 3. 로컬 base branch를 원격과 동기화 |
| **성공 시 다음 상태** | `BRANCH_CREATED` |
| **실패 조건** | 네트워크 오류, 원격 저장소 접근 불가, base branch가 원격에 없음 |
| **실패 시 다음 상태** | 재시도 3회 초과 시 `FAILED` |
| **재시도** | 지수 백오프 (1초, 2초, 4초), 최대 3회 |

```typescript
async function handleBaseSync(job: Job): Promise<void> {
  await retry(
    async () => {
      await gitManager.fetchOrigin();

      const remoteBranches = await gitManager.listRemoteBranches();
      if (!remoteBranches.includes(`origin/${job.baseBranch}`)) {
        throw new Error(`원격에 base branch가 존재하지 않음: ${job.baseBranch}`);
      }
    },
    {
      maxRetries: 3,
      backoff: "exponential",
      initialDelayMs: 1000,
    }
  );
}
```

---

### 3.4 BRANCH_CREATED

| 항목 | 내용 |
|------|------|
| **진입 조건** | `BASE_SYNCED` 상태에서 원격 동기화 완료 |
| **실행 액션** | 1. slug 생성: Issue 제목에서 브랜치명 생성 <br> 2. 브랜치명 조합: `aq/{issueNumber}-{slug}` <br> 3. 브랜치명 충돌 확인 및 해소 <br> 4. `git checkout -B aq/{n}-{slug} origin/{baseBranch}` 실행 |
| **성공 시 다음 상태** | `WORKTREE_CREATED` |
| **실패 조건** | 브랜치 생성 실패, 충돌 해소 불가 (5개 이상 동일 접두사 브랜치 존재) |
| **실패 시 다음 상태** | `FAILED` |
| **재시도** | 충돌 시 접미사 자동 추가 (-2, -3, ..., -5), 최대 2회 |

```typescript
async function handleBranchCreation(job: Job): Promise<string> {
  const slug = createSlug(job.issueTitle);
  const baseBranchName = `aq/${job.issueNumber}-${slug}`;

  // 충돌 해소
  const branchName = await resolveBranchConflict(baseBranchName, job.issueNumber);

  // base branch 보호 검증
  validateBranch(branchName);

  // 브랜치 생성
  await gitManager.createWorkBranch(job.issueNumber, slug, job.baseBranch);

  return branchName;
}
```

---

### 3.5 WORKTREE_CREATED

| 항목 | 내용 |
|------|------|
| **진입 조건** | `BRANCH_CREATED` 상태에서 작업 브랜치 생성 완료 |
| **실행 액션** | 1. worktree 경로 결정: `/tmp/ai-quartermaster/worktrees/{jobId}` <br> 2. 기존 고아 worktree 정리 (`git worktree prune`) <br> 3. `git worktree add {경로} {브랜치명}` 실행 <br> 4. worktree 경로에서 `npm install` 실행 (package.json 존재 시) |
| **성공 시 다음 상태** | `PLAN_GENERATED` |
| **실패 조건** | 디스크 공간 부족, worktree 경로 충돌, npm install 실패 |
| **실패 시 다음 상태** | 재시도 2회 초과 시 `FAILED` |
| **재시도** | 고아 worktree 정리 후 재시도, 최대 2회 |

```typescript
async function handleWorktreeCreation(job: Job, branchName: string): Promise<string> {
  // 고아 worktree 정리
  await gitManager.pruneWorktrees();

  const worktreePath = await gitManager.createWorktree(job.id, branchName);

  // 의존성 설치 (package.json 존재 시)
  const packageJsonPath = path.join(worktreePath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    await execCommand(["npm", "install"], { cwd: worktreePath });
  }

  return worktreePath;
}
```

---

### 3.6 PLAN_GENERATED

| 항목 | 내용 |
|------|------|
| **진입 조건** | `WORKTREE_CREATED` 상태에서 worktree 생성 및 의존성 설치 완료 |
| **실행 액션** | 1. 계획 생성 프롬프트 렌더링 (`plan.md` 템플릿 + Issue 컨텍스트) <br> 2. Claude CLI 호출 (읽기 전용 도구만 허용) <br> 3. 응답 파싱: phase 목록, 각 phase의 설명, 예상 파일 변경 추출 <br> 4. 계획을 `{worktree}/.ai-plan.md`에 저장 <br> 5. Issue에 계획 코멘트 작성 |
| **성공 시 다음 상태** | `PHASE_IN_PROGRESS` (phase 1) |
| **실패 조건** | Claude CLI 타임아웃, 응답 파싱 실패 (phase 구조 추출 불가) |
| **실패 시 다음 상태** | 재시도 2회 초과 시 `FAILED` |
| **재시도** | 최대 2회 |

```typescript
// 계획 응답 파싱 결과
interface ImplementationPlan {
  summary: string;
  phases: Array<{
    number: number;
    title: string;
    description: string;
    expectedFiles: string[];
    estimatedCommits: number;
  }>;
  totalPhases: number;
}

async function handlePlanGeneration(
  job: Job,
  worktreePath: string
): Promise<ImplementationPlan> {
  const prompt = renderPrompt("plan", {
    issueNumber: job.issueNumber,
    issueTitle: job.issueTitle,
    issueBody: job.issueBody,
    baseBranch: job.baseBranch,
    repository: job.repository,
  });

  const result = await claudeBridge.invoke({
    cwd: worktreePath,
    prompt,
    maxTurns: 10,
    allowedTools: ["Read", "Glob", "Grep", "Bash"],  // 읽기 전용
    timeout: 300000,  // 5분
  });

  const plan = parsePlanResponse(result.stdout);

  // 계획 파일 저장
  fs.writeFileSync(
    path.join(worktreePath, ".ai-plan.md"),
    formatPlanAsMarkdown(plan)
  );

  // Issue에 계획 코멘트
  await githubAPI.addIssueComment({
    repo: job.repository,
    issueNumber: job.issueNumber,
    body: formatPlanComment(plan),
  });

  return plan;
}
```

---

### 3.7 PHASE_IN_PROGRESS

| 항목 | 내용 |
|------|------|
| **진입 조건** | `PLAN_GENERATED`에서 첫 phase 시작, 또는 이전 phase 성공 완료 |
| **실행 액션** | 1. 현재 phase의 구현 프롬프트 렌더링 <br> 2. Claude CLI 호출 (전체 도구 허용) <br> 3. `git diff`로 변경사항 확인 <br> 4. 민감 파일 검사 <br> 5. 변경사항 커밋: `phase({N}/{M}): {phase 제목}` <br> 6. Verifier 실행 (typecheck + lint + test) |
| **성공 시 다음 상태** | 다음 phase가 있으면 → `PHASE_IN_PROGRESS` (phase N+1), 마지막 phase면 → `REVIEWING` |
| **실패 조건** | 검증 실패 (typecheck/lint/test), 민감 파일 변경 감지, Claude CLI 오류 |
| **실패 시 다음 상태** | `PHASE_FAILED` |
| **루프 구조** | Phase 1 → Phase 2 → ... → Phase N → REVIEWING |

```typescript
async function handlePhaseExecution(
  job: Job,
  worktreePath: string,
  plan: ImplementationPlan,
  currentPhase: number,
): Promise<"next_phase" | "all_done"> {
  const phase = plan.phases[currentPhase - 1];

  // 1. 구현 프롬프트 렌더링
  const prompt = renderPrompt("implement-phase", {
    issueNumber: job.issueNumber,
    issueTitle: job.issueTitle,
    issueBody: job.issueBody,
    currentPhase,
    totalPhases: plan.totalPhases,
    plan: formatPlanAsMarkdown(plan),
    phaseTitle: phase.title,
    phaseDescription: phase.description,
  });

  // 2. Claude CLI 호출
  await claudeBridge.invoke({
    cwd: worktreePath,
    prompt,
    maxTurns: 50,
    timeout: 600000,  // 10분
  });

  // 3. 변경사항 확인
  const diff = await gitManager.getDiff(worktreePath);
  if (!diff) {
    throw new Error(`Phase ${currentPhase}: 변경사항 없음`);
  }

  // 4. 민감 파일 검사
  const violations = checkSensitiveFiles(worktreePath, diff);
  if (violations.length > 0) {
    throw new SensitiveFileError(violations);
  }

  // 5. 커밋
  await gitManager.commitAll(
    worktreePath,
    `phase(${currentPhase}/${plan.totalPhases}): ${phase.title}`
  );

  // 6. 검증
  const verification = await verifier.verifyPhase(worktreePath);
  if (!verification.passed) {
    throw new VerificationError(verification);
  }

  return currentPhase < plan.totalPhases ? "next_phase" : "all_done";
}
```

#### Phase 루프 상세 흐름

```
PLAN_GENERATED
  │
  ▼
Phase 1 구현 ──> 검증 ──> 성공 ──> Phase 2 구현 ──> 검증 ──> 성공
  │                         │
  │ 실패                    │ 실패
  ▼                         ▼
PHASE_FAILED             PHASE_FAILED
  │                         │
  │ 재시도 (최대 3회)       │ 재시도 (최대 3회)
  ▼                         ▼
수정 후 재검증           수정 후 재검증
  │                         │
  │ 성공                    │ 성공
  ▼                         ▼
Phase 2로 진행           Phase 3로 진행
  │
  ... (반복)
  │
  ▼
마지막 Phase 성공 ──> REVIEWING
```

---

### 3.8 PHASE_FAILED

| 항목 | 내용 |
|------|------|
| **진입 조건** | `PHASE_IN_PROGRESS`에서 검증 실패 |
| **실행 액션** | 1. 실패한 검증 항목 및 오류 메시지 수집 <br> 2. 재시도 횟수 확인 <br> 3. 재시도 가능하면: Claude CLI에 오류 로그 전달하여 수정 요청 <br> 4. 재시도 불가하면: 해당 phase 변경 revert |
| **성공 시 다음 상태** | `PHASE_IN_PROGRESS` (동일 phase 재시도) |
| **실패 조건** | 재시도 횟수 초과 (phase당 3회) |
| **실패 시 다음 상태** | `FAILED` |
| **재시도** | phase당 최대 3회, Claude에게 오류 로그 전달 |

```typescript
async function handlePhaseFailure(
  job: Job,
  worktreePath: string,
  phaseNumber: number,
  verificationResult: VerificationResult,
  retryCount: number,
): Promise<"retry" | "abort"> {
  const MAX_PHASE_RETRIES = 3;

  if (retryCount >= MAX_PHASE_RETRIES) {
    // revert 후 실패 처리
    await gitManager.revertToLastGoodCommit(worktreePath);
    return "abort";
  }

  // 오류 로그를 Claude에게 전달하여 수정 요청
  const errorSummary = verificationResult.checks
    .filter(c => !c.passed)
    .map(c => `### ${c.name}\n\`\`\`\n${c.output}\n\`\`\``)
    .join("\n\n");

  const fixPrompt = renderPrompt("fix-phase-error", {
    phaseNumber,
    errorSummary,
    issueNumber: job.issueNumber,
    issueTitle: job.issueTitle,
  });

  await claudeBridge.invoke({
    cwd: worktreePath,
    prompt: fixPrompt,
    maxTurns: 30,
    timeout: 600000,
  });

  return "retry";
}
```

---

### 3.9 REVIEWING

| 항목 | 내용 |
|------|------|
| **진입 조건** | 모든 phase 완료 (마지막 PHASE_IN_PROGRESS 성공) |
| **실행 액션** | 3라운드 순차 실행: <br> **라운드 1 (정확성)**: 요구사항 충족, 버그, 엣지 케이스 검토 및 수정 <br> **라운드 2 (품질)**: 네이밍, 구조, 에러 처리 개선 <br> **라운드 3 (통합)**: 기존 코드와의 일관성 확인 <br> 각 라운드 후 검증(typecheck+lint+test) 실행 |
| **성공 시 다음 상태** | `SIMPLIFYING` |
| **실패 조건** | 라운드 내 검증 실패 후 재시도 2회 초과, Claude CLI 오류 |
| **실패 시 다음 상태** | `FAILED` |
| **재시도** | 라운드당 검증 실패 재시도 최대 2회 |

```typescript
const REVIEW_ROUNDS = [
  {
    round: 1,
    name: "정확성 리뷰",
    template: "review-accuracy",
    focus: "기능 요구사항 충족, 버그, 엣지 케이스",
  },
  {
    round: 2,
    name: "품질 리뷰",
    template: "review-quality",
    focus: "네이밍, 구조, 에러 처리, 타입 안전성",
  },
  {
    round: 3,
    name: "통합 리뷰",
    template: "review-integration",
    focus: "기존 코드 일관성, import 경로, 컨벤션",
  },
];

async function handleReview(
  job: Job,
  worktreePath: string,
  plan: ImplementationPlan,
): Promise<void> {
  for (const round of REVIEW_ROUNDS) {
    let roundRetries = 0;
    const MAX_ROUND_RETRIES = 2;

    while (roundRetries <= MAX_ROUND_RETRIES) {
      const prompt = renderPrompt(round.template, {
        issueNumber: job.issueNumber,
        issueTitle: job.issueTitle,
        issueBody: job.issueBody,
        plan: formatPlanAsMarkdown(plan),
        reviewRound: round.round,
        focus: round.focus,
      });

      await claudeBridge.invoke({
        cwd: worktreePath,
        prompt,
        maxTurns: 20,
        timeout: 300000,
      });

      // 변경사항 있으면 커밋
      const diff = await gitManager.getDiff(worktreePath);
      if (diff) {
        await gitManager.commitAll(
          worktreePath,
          `review(round-${round.round}): ${round.name}`
        );
      }

      // 검증
      const verification = await verifier.verifyPhase(worktreePath);
      if (verification.passed) {
        break;
      }

      roundRetries++;
      if (roundRetries > MAX_ROUND_RETRIES) {
        throw new Error(`리뷰 라운드 ${round.round} 검증 실패 (재시도 초과)`);
      }
    }
  }
}
```

---

### 3.10 SIMPLIFYING

| 항목 | 내용 |
|------|------|
| **진입 조건** | `REVIEWING` 상태에서 3라운드 리뷰 모두 완료 |
| **실행 액션** | 1. 단순화 프롬프트로 Claude CLI 호출 <br> 2. 불필요 추상화 제거, 미사용 코드 삭제, 디버그 코드 제거 <br> 3. 변경사항 커밋 <br> 4. 검증 실행 |
| **성공 시 다음 상태** | `FINAL_VALIDATING` |
| **실패 조건** | 단순화 후 검증 실패 |
| **실패 시 다음 상태** | 변경 revert 후 `FINAL_VALIDATING`으로 진행 (단순화 건너뛰기) |
| **재시도** | 없음 (실패 시 revert하고 건너뜀) |

```typescript
async function handleSimplify(
  job: Job,
  worktreePath: string,
): Promise<void> {
  const prompt = renderPrompt("simplify", {
    issueNumber: job.issueNumber,
    issueTitle: job.issueTitle,
  });

  // 현재 커밋 SHA 저장 (rollback용)
  const beforeSHA = await gitManager.getCurrentSHA(worktreePath);

  await claudeBridge.invoke({
    cwd: worktreePath,
    prompt,
    maxTurns: 15,
    timeout: 300000,
  });

  const diff = await gitManager.getDiff(worktreePath);
  if (!diff) {
    // 변경사항 없으면 그대로 진행
    return;
  }

  await gitManager.commitAll(worktreePath, "simplify: 코드 단순화 및 정리");

  const verification = await verifier.verifyPhase(worktreePath);
  if (!verification.passed) {
    // 단순화 실패 시 revert
    await gitManager.resetToCommit(worktreePath, beforeSHA);
    logger.warn("단순화 후 검증 실패, 변경 revert 완료");
  }
}
```

---

### 3.11 FINAL_VALIDATING

| 항목 | 내용 |
|------|------|
| **진입 조건** | `SIMPLIFYING` 완료 (성공 또는 건너뛰기) |
| **실행 액션** | 1. 전체 검증 실행 (typecheck + lint + test + build) <br> 2. 민감 파일 최종 검사 <br> 3. 전체 diff 대비 보호 경로 검사 |
| **성공 시 다음 상태** | `DRAFT_PR_CREATED` |
| **실패 조건** | 빌드/테스트/린트 실패, 민감 파일 감지 |
| **실패 시 다음 상태** | Claude에게 수정 요청 후 재검증, 재시도 2회 초과 시 `FAILED` |
| **재시도** | 최대 2회 (Claude에게 전체 오류 로그 전달) |

```typescript
async function handleFinalValidation(
  job: Job,
  worktreePath: string,
): Promise<void> {
  let retries = 0;
  const MAX_RETRIES = 2;

  while (retries <= MAX_RETRIES) {
    const verification = await verifier.verifyFinal(worktreePath);

    if (verification.passed) {
      // 민감 파일 최종 검사
      const fullDiff = await gitManager.getDiffFromBase(worktreePath, job.baseBranch);
      const violations = checkSensitiveFiles(worktreePath, fullDiff);
      const pathViolations = validateChangedFiles(getChangedFiles(fullDiff));

      if (violations.length === 0 && pathViolations.length === 0) {
        return;  // 성공
      }

      throw new SafeguardError(
        [...violations, ...pathViolations].join("\n")
      );
    }

    retries++;
    if (retries > MAX_RETRIES) {
      throw new Error("최종 검증 실패 (재시도 초과)");
    }

    // Claude에게 수정 요청
    const errorSummary = verification.checks
      .filter(c => !c.passed)
      .map(c => `### ${c.name}\n\`\`\`\n${c.output}\n\`\`\``)
      .join("\n\n");

    await claudeBridge.invoke({
      cwd: worktreePath,
      prompt: renderPrompt("fix-final-validation", {
        issueNumber: job.issueNumber,
        errorSummary,
      }),
      maxTurns: 20,
      timeout: 300000,
    });

    // 수정사항 커밋
    const diff = await gitManager.getDiff(worktreePath);
    if (diff) {
      await gitManager.commitAll(worktreePath, "fix: 최종 검증 오류 수정");
    }
  }
}
```

---

### 3.12 DRAFT_PR_CREATED

| 항목 | 내용 |
|------|------|
| **진입 조건** | `FINAL_VALIDATING` 성공 |
| **실행 액션** | 1. 작업 브랜치를 원격에 push <br> 2. PR 본문 생성 (계획, phase 요약, 검증 결과 포함) <br> 3. `gh pr create --draft` 실행 <br> 4. Issue에 PR 링크 코멘트 작성 |
| **성공 시 다음 상태** | `DONE` |
| **실패 조건** | push 실패, PR 생성 실패 (권한 부족, 네트워크 오류) |
| **실패 시 다음 상태** | 재시도 3회 초과 시 `FAILED` |
| **재시도** | 최대 3회 |

```typescript
async function handleDraftPRCreation(
  job: Job,
  worktreePath: string,
  branchName: string,
  plan: ImplementationPlan,
): Promise<{ prNumber: number; prUrl: string }> {
  // 1. Push
  await retry(
    () => gitManager.push(worktreePath, branchName),
    { maxRetries: 3, backoff: "exponential", initialDelayMs: 2000 }
  );

  // 2. PR 본문 생성
  const prBody = renderPrompt("pr-body", {
    issueNumber: job.issueNumber,
    issueTitle: job.issueTitle,
    plan: formatPlanAsMarkdown(plan),
  });

  // 3. Draft PR 생성
  const pr = await githubAPI.createDraftPR({
    repo: job.repository,
    head: branchName,
    base: job.baseBranch,
    title: `[AI] #${job.issueNumber}: ${job.issueTitle}`,
    body: prBody,
    draft: true,
  });

  // 4. Issue에 코멘트
  await githubAPI.addIssueComment({
    repo: job.repository,
    issueNumber: job.issueNumber,
    body: `## AI 병참부 - 구현 완료\n\nDraft PR이 생성되었습니다: ${pr.url}\n\n검토 후 승인/머지해 주세요.`,
  });

  // 5. 라벨 업데이트 (미구현: "ai-in-progress" 제거, "ai-review-ready" 추가는 코드에 구현되지 않음)

  return pr;
}
```

---

### 3.13 DONE

| 항목 | 내용 |
|------|------|
| **진입 조건** | `DRAFT_PR_CREATED` 성공 |
| **실행 액션** | 1. worktree 정리 (`git worktree remove`) <br> 2. 성공 로그 저장 <br> 3. Job 상태 최종 업데이트 |
| **성공 시 다음 상태** | 종료 (터미널 상태) |
| **실패 조건** | 없음 (정리 실패는 경고만 기록) |
| **실패 시 다음 상태** | 없음 |

```typescript
async function handleDone(job: Job): Promise<void> {
  // Worktree 정리 (실패해도 무시)
  try {
    await gitManager.removeWorktree(job.id);
  } catch (err) {
    logger.warn(`Worktree 정리 실패 (무시): ${err}`);
  }

  // 브랜치는 유지 (PR이 열려있으므로)

  logger.info(`Job ${job.id} 완료: Issue #${job.issueNumber}`);
}
```

---

### 3.14 FAILED

| 항목 | 내용 |
|------|------|
| **진입 조건** | 어떤 상태에서든 복구 불가능한 실패 발생 |
| **실행 액션** | 1. Issue에 실패 코멘트 작성 (실패 상태, 오류 메시지, 오류 로그) <br> 2. worktree 정리 <br> 3. 실패한 브랜치 삭제 (PR이 없는 경우만) <br> 4. 실패 로그 저장 |
| **성공 시 다음 상태** | 종료 (터미널 상태) |
| **재진입** | Issue에 `instanceLabel` (기본값: `aqm`) 라벨을 다시 부여하면 `RECEIVED`부터 재시작 |

```typescript
async function handleFailed(job: Job, error: Error): Promise<void> {
  // 1. 실패 코멘트
  await githubAPI.addIssueComment({
    repo: job.repository,
    issueNumber: job.issueNumber,
    body: formatFailureComment(job, error),
  });

  // 2. 라벨 업데이트 (미구현: "ai-in-progress" 제거, "ai-failed" 추가는 코드에 구현되지 않음)

  // 3. Worktree 정리
  try {
    await gitManager.removeWorktree(job.id);
  } catch (err) {
    logger.warn(`Worktree 정리 실패 (무시): ${err}`);
  }

  // 4. 브랜치 정리 (PR이 없는 경우)
  if (job.branchName) {
    try {
      const hasPR = await githubAPI.hasPullRequest(job.repository, job.branchName);
      if (!hasPR) {
        await gitManager.deleteBranch(job.branchName);
      }
    } catch (err) {
      logger.warn(`브랜치 정리 실패 (무시): ${err}`);
    }
  }

  // 5. 실패 로그 저장
  await logStore.saveFailureLog(job.id, {
    state: job.status,
    error: error.message,
    stack: error.stack,
    timestamp: new Date(),
  });
}
```

---

## 4. 상태 전이 요약 매트릭스

| 현재 상태 | 성공 시 | 실패 시 | 재시도 가능 | 최대 재시도 |
|-----------|---------|---------|------------|------------|
| `RECEIVED` | `VALIDATED` | `FAILED` | X | 0 |
| `VALIDATED` | `BASE_SYNCED` | `FAILED` | X | 0 |
| `BASE_SYNCED` | `BRANCH_CREATED` | `FAILED` | O | 3 |
| `BRANCH_CREATED` | `WORKTREE_CREATED` | `FAILED` | O | 2 |
| `WORKTREE_CREATED` | `PLAN_GENERATED` | `FAILED` | O | 2 |
| `PLAN_GENERATED` | `PHASE_IN_PROGRESS` | `FAILED` | O | 2 |
| `PHASE_IN_PROGRESS` | `PHASE_IN_PROGRESS` / `REVIEWING` | `PHASE_FAILED` | - | - |
| `PHASE_FAILED` | `PHASE_IN_PROGRESS` | `FAILED` | O | 3 (phase당) |
| `REVIEWING` | `SIMPLIFYING` | `FAILED` | O | 2 (라운드당) |
| `SIMPLIFYING` | `FINAL_VALIDATING` | `FINAL_VALIDATING` (revert) | X | 0 (revert) |
| `FINAL_VALIDATING` | `DRAFT_PR_CREATED` | `FAILED` | O | 2 |
| `DRAFT_PR_CREATED` | `DONE` | `FAILED` | O | 3 |
| `DONE` | (종료) | - | - | - |
| `FAILED` | (종료, 라벨 재부여로 재시작) | - | - | - |

---

## 5. 상태 저장 (State Store)

```typescript
interface StateStore {
  // Job 상태 조회
  getJobState(jobId: string): Promise<JobState>;

  // 상태 전이 (이전 상태 검증 포함)
  transition(jobId: string, newState: PipelineState, metadata?: Record<string, unknown>): Promise<void>;

  // 상태 이력 조회
  getStateHistory(jobId: string): Promise<StateTransition[]>;
}

interface StateTransition {
  fromState: PipelineState;
  toState: PipelineState;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  error?: string;
}

// 유효한 전이만 허용
const VALID_TRANSITIONS: Record<PipelineState, PipelineState[]> = {
  RECEIVED:          ["VALIDATED", "FAILED"],
  VALIDATED:         ["BASE_SYNCED", "FAILED"],
  BASE_SYNCED:       ["BRANCH_CREATED", "FAILED"],
  BRANCH_CREATED:    ["WORKTREE_CREATED", "FAILED"],
  WORKTREE_CREATED:  ["PLAN_GENERATED", "FAILED"],
  PLAN_GENERATED:    ["PHASE_IN_PROGRESS", "FAILED"],
  PHASE_IN_PROGRESS: ["PHASE_IN_PROGRESS", "PHASE_FAILED", "REVIEWING", "FAILED"],
  PHASE_FAILED:      ["PHASE_IN_PROGRESS", "FAILED"],
  REVIEWING:         ["SIMPLIFYING", "FAILED"],
  SIMPLIFYING:       ["FINAL_VALIDATING"],
  FINAL_VALIDATING:  ["DRAFT_PR_CREATED", "FAILED"],
  DRAFT_PR_CREATED:  ["DONE", "FAILED"],
  DONE:              [],
  FAILED:            [],
};
```
