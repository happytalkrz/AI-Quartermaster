# Document 4: 설정 파일 스키마 (config.yml)

## 개요

AI 병참부의 모든 동작은 프로젝트 루트의 `config.yml` 파일로 제어된다. 이 문서는 설정 파일의 전체 스키마, 각 필드의 타입/기본값/설명, 그리고 대응하는 TypeScript 인터페이스를 정의한다.

---

## 설정 파일 위치

```
AI-Quartermaster/
  config.yml          # 기본 설정
  config.local.yml    # 로컬 오버라이드 (gitignore 대상)
```

로딩 우선순위: `config.yml` < `config.local.yml`. 깊은 병합(deep merge) 방식으로 합산한다.

> 참고: 환경변수 오버라이드(`AQ_` 접두사)는 향후 구현 예정

---

## 전체 스키마

### 1. `general` — 일반 설정

| 필드 | 타입 | 기본값 | 필수 | 설명 |
|------|------|--------|------|------|
| `general.projectName` | `string` | `""` | O | 프로젝트 이름. 로그/PR 본문에 표시 |
| `general.logLevel` | `"debug" \| "info" \| "warn" \| "error"` | `"info"` | X | 로그 출력 레벨 |
| `general.logDir` | `string` | `"./logs"` | X | 로그 파일 저장 디렉토리 경로 |
| `general.dryRun` | `boolean` | `false` | X | `true`면 git push, PR 생성 등 외부 변경을 실행하지 않고 로그만 남긴다 |
| `general.locale` | `string` | `"ko"` | X | PR 본문, 커밋 메시지의 언어 (`"ko"` \| `"en"`) |
| `general.concurrency` | `number` | `1` | X | 동시에 처리할 최대 이슈 수. 워크트리 기반이므로 병렬 가능 |
| `general.pollingIntervalMs` | `number` | `60000` | X | 폴링 모드에서 이슈 목록을 조회하는 간격 (ms) |
| `general.stuckTimeoutMs` | `number` | `600000` | X | 실행 중 잡이 이 시간을 초과하면 멈춘 것으로 간주 (ms) |
| `general.maxJobs` | `number` | `500` | X | 저장소에 보관할 최대 잡 수. 초과 시 오래된 완료/실패 잡부터 삭제 |

### 2. `git` — Git 관련 설정

| 필드 | 타입 | 기본값 | 필수 | 설명 |
|------|------|--------|------|------|
| `git.defaultBaseBranch` | `string` | `"master"` | X | 이슈에 베이스 브랜치가 명시되지 않았을 때 사용할 기본 브랜치 |
| `git.branchTemplate` | `string` | `"ax/{issueNumber}-{slug}"` | X | 작업 브랜치 이름 템플릿. 사용 가능 변수: `{issueNumber}`, `{slug}`, `{timestamp}` |
| `git.commitMessageTemplate` | `string` | `"[#{issueNumber}] {phase}: {summary}"` | X | 커밋 메시지 템플릿. 변수: `{issueNumber}`, `{phase}`, `{summary}`, `{phaseIndex}` |
| `git.remoteAlias` | `string` | `"origin"` | X | git remote 이름 |
| `git.allowedRepos` | `string[]` | `[]` | O | 허용된 저장소 목록 (형식: `"owner/repo"`). 빈 배열이면 모든 저장소에서 동작 불가 |
| `git.gitPath` | `string` | `"git"` | X | git 바이너리 경로 |
| `git.fetchDepth` | `number` | `0` | X | `git fetch --depth` 값. `0`은 전체 히스토리 |
| `git.signCommits` | `boolean` | `false` | X | GPG 서명 커밋 여부 |

### 3. `worktree` — 워크트리 설정

| 필드 | 타입 | 기본값 | 필수 | 설명 |
|------|------|--------|------|------|
| `worktree.rootPath` | `string` | `"../.aq-worktrees"` | X | 워크트리 생성 루트 디렉토리. 프로젝트 루트 기준 상대경로 또는 절대경로 |
| `worktree.cleanupOnSuccess` | `boolean` | `true` | X | PR 생성 성공 후 워크트리 자동 삭제 여부 |
| `worktree.cleanupOnFailure` | `boolean` | `false` | X | 파이프라인 실패 시 워크트리 자동 삭제 여부 (디버깅용으로 보존 권장) |
| `worktree.maxAge` | `string` | `"7d"` | X | 이 기간을 초과한 워크트리 자동 정리. 형식: `"1d"`, `"12h"`, `"30m"` |
| `worktree.dirTemplate` | `string` | `"{issueNumber}-{slug}"` | X | 워크트리 디렉토리 이름 템플릿 |

### 4. `commands` — 외부 명령어 설정

| 필드 | 타입 | 기본값 | 필수 | 설명 |
|------|------|--------|------|------|
| `commands.claudeCli.path` | `string` | `"claude"` | X | Claude CLI 바이너리 경로 |
| `commands.claudeCli.model` | `string` | `"claude-opus-4-5"` | X | 글로벌 기본 Claude 모델 ID (`models` 미설정 시 사용) |
| `commands.claudeCli.models.plan` | `string` | `"claude-opus-4-5"` | X | Plan 생성 단계 모델 |
| `commands.claudeCli.models.phase` | `string` | `"claude-sonnet-4-20250514"` | X | Phase 구현 단계 모델 |
| `commands.claudeCli.models.review` | `string` | `"claude-haiku-4-5-20251001"` | X | 리뷰/검증 단계 모델 |
| `commands.claudeCli.models.fallback` | `string` | `"claude-sonnet-4-20250514"` | X | 실패 시 폴백 모델 |
| `commands.claudeCli.maxTurns` | `number` | `50` | X | Claude CLI `--max-turns` 값 |
| `commands.claudeCli.timeout` | `number` | `600000` | X | Claude CLI 단일 호출 타임아웃 (ms) |
| `commands.claudeCli.additionalArgs` | `string[]` | `[]` | X | Claude CLI에 전달할 추가 인자 (예: `["--verbose"]`) |
| `commands.ghCli.path` | `string` | `"gh"` | X | GitHub CLI 바이너리 경로 |
| `commands.ghCli.timeout` | `number` | `30000` | X | gh CLI 호출 타임아웃 (ms) |
| `commands.test` | `string` | `"npm test"` | X | 테스트 실행 명령어 |
| `commands.lint` | `string` | `"npm run lint"` | X | 린트 실행 명령어 |
| `commands.build` | `string` | `"npm run build"` | X | 빌드 실행 명령어 |
| `commands.typecheck` | `string` | `""` | X | 타입 체크 명령어. 빈 문자열이면 건너뜀 |
| `commands.preInstall` | `string` | `"npm ci"` | X | 워크트리 생성 후 의존성 설치 명령어 |
| `commands.claudeMdPath` | `string` | `"CLAUDE.md"` | X | Claude에게 전달할 컨텍스트 파일 경로 (워크트리 기준) |

### 5. `review` — 리뷰 라운드 설정

| 필드 | 타입 | 기본값 | 필수 | 설명 |
|------|------|--------|------|------|
| `review.enabled` | `boolean` | `true` | X | 리뷰 프로세스 활성화 여부 |
| `review.rounds` | `ReviewRound[]` | (아래 참조) | X | 리뷰 라운드 배열 |
| `review.rounds[].name` | `string` | — | O | 라운드 이름 (예: `"기능 정합성"`) |
| `review.rounds[].promptTemplate` | `string` | — | O | 사용할 프롬프트 템플릿 파일 경로 (prompts/ 기준 상대경로) |
| `review.rounds[].failAction` | `"block" \| "warn" \| "retry"` | `"block"` | X | 리뷰 실패 시 동작 |
| `review.rounds[].maxRetries` | `number` | `2` | X | `failAction: "retry"` 일 때 최대 재시도 횟수 |
| `review.rounds[].model` | `string \| null` | `null` | X | 이 라운드에 사용할 모델. `null`이면 `commands.claudeCli.model` 사용 |
| `review.simplify.enabled` | `boolean` | `true` | X | 3라운드 리뷰 후 코드 간소화 단계 실행 여부 |
| `review.simplify.promptTemplate` | `string` | `"review-round3-simplify.md"` | X | 간소화 프롬프트 템플릿 파일 경로 |

`review.rounds` 기본값:

```yaml
rounds:
  - name: "기능 정합성"
    promptTemplate: "review-round1.md"
    failAction: "retry"
    maxRetries: 2
  - name: "구조/설계"
    promptTemplate: "review-round2.md"
    failAction: "warn"
    maxRetries: 1
  - name: "단순화"
    promptTemplate: "review-round3-simplify.md"
    failAction: "warn"
    maxRetries: 1
```

### 6. `pr` — Pull Request 설정

| 필드 | 타입 | 기본값 | 필수 | 설명 |
|------|------|--------|------|------|
| `pr.targetBranch` | `string` | `"master"` | X | PR의 목표 브랜치. 비어 있으면 `git.defaultBaseBranch` 사용 |
| `pr.draft` | `boolean` | `true` | X | Draft PR로 생성할지 여부 |
| `pr.titleTemplate` | `string` | `"[AQ-#{issueNumber}] {title}"` | X | PR 제목 템플릿 |
| `pr.bodyTemplate` | `string` | `"pr-body.md"` | X | PR 본문 템플릿 파일 경로 (prompts/ 기준) |
| `pr.labels` | `string[]` | `["ai-quartermaster"]` | X | PR에 자동 부여할 라벨 |
| `pr.assignees` | `string[]` | `[]` | X | PR에 자동 할당할 사용자 |
| `pr.reviewers` | `string[]` | `[]` | X | PR에 자동 리뷰 요청할 사용자 |
| `pr.linkIssue` | `boolean` | `true` | X | PR 본문에 `Closes #issueNumber` 자동 포함 여부 |
| `pr.autoMerge` | `boolean` | `false` | X | 모든 체크 통과 후 자동 머지 활성화 여부 (위험: 비권장) |
| `pr.mergeMethod` | `"merge" \| "squash" \| "rebase"` | `"squash"` | X | 머지 방법 |

### 7. `safety` — 안전장치 설정

| 필드 | 타입 | 기본값 | 필수 | 설명 |
|------|------|--------|------|------|
| `safety.sensitivePaths` | `string[]` | (아래 참조) | X | 수정 금지 파일/디렉토리 glob 패턴 목록. 이 경로가 변경되면 파이프라인 중단 |
| `safety.maxPhases` | `number` | `10` | X | 하나의 이슈에서 생성 가능한 최대 phase 수. 초과 시 파이프라인 중단 |
| `safety.maxRetries` | `number` | `3` | X | 각 단계(plan, implement, review)의 최대 재시도 횟수 |
| `safety.maxTotalDurationMs` | `number` | `3600000` | X | 이슈 하나의 전체 파이프라인 최대 소요 시간 (ms). 기본 1시간 |
| `safety.maxFileChanges` | `number` | `30` | X | 하나의 이슈에서 변경 가능한 최대 파일 수 |
| `safety.maxInsertions` | `number` | `2000` | X | 총 추가 라인 수 상한 |
| `safety.maxDeletions` | `number` | `1000` | X | 총 삭제 라인 수 상한 |
| `safety.requireTests` | `boolean` | `true` | X | 테스트 파일이 하나도 변경/추가되지 않으면 파이프라인 중단 |
| `safety.blockDirectBasePush` | `boolean` | `true` | X | 베이스 브랜치에 직접 push 시도 차단 |
| `safety.timeouts.planGeneration` | `number` | `120000` | X | Plan 생성 타임아웃 (ms) |
| `safety.timeouts.phaseImplementation` | `number` | `300000` | X | Phase 하나 구현 타임아웃 (ms) |
| `safety.timeouts.reviewRound` | `number` | `120000` | X | 리뷰 라운드 하나 타임아웃 (ms) |
| `safety.timeouts.prCreation` | `number` | `30000` | X | PR 생성 타임아웃 (ms) |
| `safety.stopConditions` | `string[]` | (아래 참조) | X | 파이프라인 즉시 중단 조건 문자열 패턴 |
| `safety.allowedLabels` | `string[]` | `["ai-quartermaster", "aq-auto"]` | X | 이 라벨이 있는 이슈만 처리. 빈 배열이면 모든 이슈 처리 |

`safety.sensitivePaths` 기본값:

```yaml
sensitivePaths:
  - ".env*"
  - "**/*.pem"
  - "**/*.key"
  - "**/secrets/**"
  - "**/credentials/**"
  - "config.yml"
  - "config.local.yml"
  - "package-lock.json"
  - "yarn.lock"
  - "pnpm-lock.yaml"
  - ".github/workflows/**"
  - "Dockerfile"
  - "docker-compose*.yml"
```

`safety.stopConditions` 기본값:

```yaml
stopConditions:
  - "CRITICAL_ERROR"
  - "SECURITY_VIOLATION"
  - "BASE_BRANCH_MODIFIED"
  - "SENSITIVE_PATH_CHANGED"
  - "MAX_RETRIES_EXCEEDED"
  - "TIMEOUT_EXCEEDED"
  - "TEST_FAILURE_PERSISTENT"
```

---

## 완전한 설정 파일 예시

```yaml
# config.yml — AI 병참부 설정 파일
# 프로젝트: my-web-app

general:
  projectName: "my-web-app"
  logLevel: "info"
  logDir: "./logs"
  dryRun: false
  locale: "ko"
  concurrency: 2

git:
  defaultBaseBranch: "master"
  branchTemplate: "ax/{issueNumber}-{slug}"
  commitMessageTemplate: "[#{issueNumber}] {phase}: {summary}"
  remoteAlias: "origin"
  allowedRepos:
    - "myorg/my-web-app"
    - "myorg/my-web-app-v2"
  gitPath: "git"
  fetchDepth: 0
  signCommits: false

worktree:
  rootPath: "../.aq-worktrees"
  cleanupOnSuccess: true
  cleanupOnFailure: false
  maxAge: "7d"
  dirTemplate: "{issueNumber}-{slug}"

commands:
  claudeCli:
    path: "claude"
    model: "claude-opus-4-5"
    models:
      plan: "claude-opus-4-5"
      phase: "claude-sonnet-4-20250514"
      review: "claude-haiku-4-5-20251001"
      fallback: "claude-sonnet-4-20250514"
    maxTurns: 50
    timeout: 600000
    additionalArgs: []
  ghCli:
    path: "gh"
    timeout: 30000
  test: "npm test"
  lint: "npm run lint"
  build: "npm run build"
  typecheck: "npx tsc --noEmit"
  preInstall: "npm ci"
  claudeMdPath: "CLAUDE.md"

review:
  enabled: true
  rounds:
    - name: "기능 정합성"
      promptTemplate: "review-round1.md"
      failAction: "retry"
      maxRetries: 2
      model: null
    - name: "구조/설계"
      promptTemplate: "review-round2.md"
      failAction: "warn"
      maxRetries: 1
      model: null
    - name: "단순화"
      promptTemplate: "review-round3-simplify.md"
      failAction: "warn"
      maxRetries: 1
      model: null
  simplify:
    enabled: true
    promptTemplate: "review-round3-simplify.md"

pr:
  targetBranch: "master"
  draft: true
  titleTemplate: "[AQ-#{issueNumber}] {title}"
  bodyTemplate: "pr-body.md"
  labels:
    - "ai-quartermaster"
  assignees: []
  reviewers:
    - "lead-dev"
  linkIssue: true
  autoMerge: false
  mergeMethod: "squash"

safety:
  sensitivePaths:
    - ".env*"
    - "**/*.pem"
    - "**/*.key"
    - "**/secrets/**"
    - "**/credentials/**"
    - "config.yml"
    - "config.local.yml"
    - "package-lock.json"
    - "yarn.lock"
    - "pnpm-lock.yaml"
    - ".github/workflows/**"
    - "Dockerfile"
    - "docker-compose*.yml"
  maxPhases: 10
  maxRetries: 3
  maxTotalDurationMs: 3600000
  maxFileChanges: 30
  maxInsertions: 2000
  maxDeletions: 1000
  requireTests: true
  blockDirectBasePush: true
  timeouts:
    planGeneration: 120000
    phaseImplementation: 300000
    reviewRound: 120000
    prCreation: 30000
  stopConditions:
    - "CRITICAL_ERROR"
    - "SECURITY_VIOLATION"
    - "BASE_BRANCH_MODIFIED"
    - "SENSITIVE_PATH_CHANGED"
    - "MAX_RETRIES_EXCEEDED"
    - "TIMEOUT_EXCEEDED"
    - "TEST_FAILURE_PERSISTENT"
  allowedLabels:
    - "ai-quartermaster"
    - "aq-auto"
```

---

## TypeScript 인터페이스

```typescript
// src/types/config.ts

/** 로그 레벨 */
type LogLevel = "debug" | "info" | "warn" | "error";

/** 언어 설정 */
type Locale = "ko" | "en";

/** 리뷰 실패 시 동작 */
type ReviewFailAction = "block" | "warn" | "retry";

/** PR 머지 방법 */
type MergeMethod = "merge" | "squash" | "rebase";

/** 기간 문자열 (예: "7d", "12h", "30m") */
type DurationString = string;

// ─── 섹션별 인터페이스 ──────────────────────────────────────

export interface GeneralConfig {
  /** 프로젝트 이름 */
  projectName: string;
  /** 로그 출력 레벨 */
  logLevel: LogLevel;
  /** 로그 파일 저장 디렉토리 */
  logDir: string;
  /** true면 외부 변경(push, PR 등) 미실행 */
  dryRun: boolean;
  /** PR/커밋 메시지 언어 */
  locale: Locale;
  /** 동시 처리 최대 이슈 수 */
  concurrency: number;
}

export interface GitConfig {
  /** 기본 베이스 브랜치 */
  defaultBaseBranch: string;
  /** 작업 브랜치 이름 템플릿 */
  branchTemplate: string;
  /** 커밋 메시지 템플릿 */
  commitMessageTemplate: string;
  /** git remote 이름 */
  remoteAlias: string;
  /** 허용된 저장소 목록 ("owner/repo") */
  allowedRepos: string[];
  /** git 바이너리 경로 */
  gitPath: string;
  /** git fetch --depth 값 (0 = 전체) */
  fetchDepth: number;
  /** GPG 서명 커밋 여부 */
  signCommits: boolean;
}

export interface WorktreeConfig {
  /** 워크트리 생성 루트 디렉토리 */
  rootPath: string;
  /** 성공 시 워크트리 자동 삭제 */
  cleanupOnSuccess: boolean;
  /** 실패 시 워크트리 자동 삭제 */
  cleanupOnFailure: boolean;
  /** 워크트리 최대 보존 기간 */
  maxAge: DurationString;
  /** 워크트리 디렉토리 이름 템플릿 */
  dirTemplate: string;
}

export interface ClaudeCliConfig {
  /** Claude CLI 바이너리 경로 */
  path: string;
  /** Claude 모델 ID */
  model: string;
  /** 최대 턴 수 */
  maxTurns: number;
  /** 단일 호출 타임아웃 (ms) */
  timeout: number;
  /** 추가 CLI 인자 */
  additionalArgs: string[];
}

export interface GhCliConfig {
  /** gh CLI 바이너리 경로 */
  path: string;
  /** 호출 타임아웃 (ms) */
  timeout: number;
}

export interface CommandsConfig {
  /** Claude CLI 설정 */
  claudeCli: ClaudeCliConfig;
  /** GitHub CLI 설정 */
  ghCli: GhCliConfig;
  /** 테스트 명령어 */
  test: string;
  /** 린트 명령어 */
  lint: string;
  /** 빌드 명령어 */
  build: string;
  /** 타입 체크 명령어 (빈 문자열이면 건너뜀) */
  typecheck: string;
  /** 워크트리 생성 후 의존성 설치 명령어 */
  preInstall: string;
  /** Claude가 실행 가능한 셸 명령어 화이트리스트 */
  shellWhitelist: string[];
}

export interface ReviewRound {
  /** 라운드 이름 */
  name: string;
  /** 프롬프트 템플릿 파일 경로 */
  promptTemplate: string;
  /** 리뷰 실패 시 동작 */
  failAction: ReviewFailAction;
  /** 최대 재시도 횟수 */
  maxRetries: number;
  /** 이 라운드에 사용할 모델 (null이면 기본 모델) */
  model: string | null;
}

export interface SimplifyConfig {
  /** 간소화 단계 활성화 여부 */
  enabled: boolean;
  /** 간소화 프롬프트 템플릿 파일 경로 */
  promptTemplate: string;
}

export interface ReviewConfig {
  /** 리뷰 프로세스 활성화 여부 */
  enabled: boolean;
  /** 리뷰 라운드 배열 */
  rounds: ReviewRound[];
  /** 코드 간소화 설정 */
  simplify: SimplifyConfig;
}

export interface PrConfig {
  /** PR 목표 브랜치 */
  targetBranch: string;
  /** Draft PR 여부 */
  draft: boolean;
  /** PR 제목 템플릿 */
  titleTemplate: string;
  /** PR 본문 템플릿 파일 경로 */
  bodyTemplate: string;
  /** 자동 부여 라벨 */
  labels: string[];
  /** 자동 할당 사용자 */
  assignees: string[];
  /** 자동 리뷰 요청 사용자 */
  reviewers: string[];
  /** Closes #issueNumber 자동 포함 여부 */
  linkIssue: boolean;
  /** 자동 머지 활성화 (비권장) */
  autoMerge: boolean;
  /** 머지 방법 */
  mergeMethod: MergeMethod;
}

export interface TimeoutsConfig {
  /** Plan 생성 타임아웃 (ms) */
  planGeneration: number;
  /** Phase 구현 타임아웃 (ms) */
  phaseImplementation: number;
  /** 리뷰 라운드 타임아웃 (ms) */
  reviewRound: number;
  /** PR 생성 타임아웃 (ms) */
  prCreation: number;
}

export interface SafetyConfig {
  /** 수정 금지 glob 패턴 목록 */
  sensitivePaths: string[];
  /** 최대 phase 수 */
  maxPhases: number;
  /** 각 단계 최대 재시도 횟수 */
  maxRetries: number;
  /** 전체 파이프라인 최대 시간 (ms) */
  maxTotalDurationMs: number;
  /** 최대 변경 파일 수 */
  maxFileChanges: number;
  /** 최대 추가 라인 수 */
  maxInsertions: number;
  /** 최대 삭제 라인 수 */
  maxDeletions: number;
  /** 테스트 변경 필수 여부 */
  requireTests: boolean;
  /** 베이스 브랜치 직접 push 차단 */
  blockDirectBasePush: boolean;
  /** 단계별 타임아웃 */
  timeouts: TimeoutsConfig;
  /** 파이프라인 즉시 중단 조건 패턴 */
  stopConditions: string[];
  /** 처리 가능한 이슈 라벨 */
  allowedLabels: string[];
}

// ─── 최상위 설정 인터페이스 ────────────────────────────────

export interface AQConfig {
  general: GeneralConfig;
  git: GitConfig;
  worktree: WorktreeConfig;
  commands: CommandsConfig;
  review: ReviewConfig;
  pr: PrConfig;
  safety: SafetyConfig;
}
```

---

## 설정 로딩 및 검증 의사 코드

```typescript
// src/config/loader.ts

import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { merge } from "lodash-es";
import { AQConfig } from "../types/config";
import { DEFAULT_CONFIG } from "./defaults";
import { validateConfig } from "./validator";

export function loadConfig(projectRoot: string): AQConfig {
  const baseConfigPath = `${projectRoot}/config.yml`;
  const localConfigPath = `${projectRoot}/config.local.yml`;

  // 1) 기본값에서 시작
  let config: AQConfig = structuredClone(DEFAULT_CONFIG);

  // 2) config.yml 로드 및 병합
  if (!existsSync(baseConfigPath)) {
    throw new Error(`config.yml not found at ${baseConfigPath}`);
  }
  const baseRaw = parseYaml(readFileSync(baseConfigPath, "utf-8"));
  config = merge(config, baseRaw);

  // 3) config.local.yml이 있으면 오버라이드
  if (existsSync(localConfigPath)) {
    const localRaw = parseYaml(readFileSync(localConfigPath, "utf-8"));
    config = merge(config, localRaw);
  }

  // 4) 환경변수 오버라이드 (AQ_ 접두사)
  config = applyEnvOverrides(config);

  // 5) 검증
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new Error(
      `config.yml 검증 실패:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }

  return config;
}

function applyEnvOverrides(config: AQConfig): AQConfig {
  // AQ_GENERAL_LOG_LEVEL -> config.general.logLevel
  // AQ_GIT_DEFAULT_BASE_BRANCH -> config.git.defaultBaseBranch
  // 환경변수 이름을 camelCase 경로로 변환하여 적용
  const prefix = "AQ_";
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || value === undefined) continue;
    const path = key
      .slice(prefix.length)
      .toLowerCase()
      .split("_")
      .reduce((acc, part, i) => {
        if (i === 0) return part;
        // 섹션 구분자와 camelCase 변환
        return acc + part.charAt(0).toUpperCase() + part.slice(1);
      }, "");
    // lodash set으로 깊은 경로 설정
    // set(config, path, parseValue(value));
  }
  return config;
}
```

---

## 검증 규칙

```typescript
// src/config/validator.ts

import { AQConfig } from "../types/config";

export function validateConfig(config: AQConfig): string[] {
  const errors: string[] = [];

  // 필수 필드 검증
  if (!config.general.projectName) {
    errors.push("general.projectName은 필수입니다");
  }

  if (config.git.allowedRepos.length === 0) {
    errors.push("git.allowedRepos에 최소 하나의 저장소를 지정해야 합니다");
  }

  // 템플릿 변수 검증
  if (!config.git.branchTemplate.includes("{issueNumber}")) {
    errors.push("git.branchTemplate에 {issueNumber} 변수가 필요합니다");
  }

  // 범위 검증
  if (config.safety.maxPhases < 1 || config.safety.maxPhases > 20) {
    errors.push("safety.maxPhases는 1~20 사이여야 합니다");
  }

  if (config.safety.maxRetries < 1 || config.safety.maxRetries > 10) {
    errors.push("safety.maxRetries는 1~10 사이여야 합니다");
  }

  if (config.commands.claudeCli.maxTurns < 1) {
    errors.push("commands.claudeCli.maxTurns는 1 이상이어야 합니다");
  }

  // 리뷰 라운드 검증
  for (const round of config.review.rounds) {
    if (!round.name) {
      errors.push("review.rounds[].name은 필수입니다");
    }
    if (!round.promptTemplate) {
      errors.push(`review.rounds[${round.name}].promptTemplate은 필수입니다`);
    }
  }

  // 타임아웃 양수 검증
  for (const [key, val] of Object.entries(config.safety.timeouts)) {
    if (typeof val === "number" && val <= 0) {
      errors.push(`safety.timeouts.${key}는 양수여야 합니다`);
    }
  }

  return errors;
}
```

---

## 설정 변경 시 영향 범위 매핑

| 변경된 설정 | 영향을 받는 파이프라인 단계 |
|------------|--------------------------|
| `git.defaultBaseBranch` | 브랜치 결정, PR 대상 |
| `git.branchTemplate` | 브랜치 생성 |
| `worktree.rootPath` | 워크트리 생성/정리 |
| `commands.test` | 구현 검증, 최종 검증 |
| `commands.claudeCli.model` | 전 단계 (plan, implement, review) |
| `review.rounds` | 리뷰 단계 |
| `safety.sensitivePaths` | 구현 후 변경 파일 검증 |
| `safety.maxPhases` | Plan 생성 시 phase 수 제한 |
| `pr.draft` | PR 생성 |
| `pr.targetBranch` | PR 생성 |
