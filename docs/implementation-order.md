# Document 6: 최소 구현 순서

## 개요

AI 병참부를 5단계에 걸쳐 점진적으로 구축하는 구현 계획이다. 각 Phase는 이전 Phase의 산출물 위에 쌓이며, Phase 1 완료만으로도 핵심 동작을 검증할 수 있다.

---

## 전체 Phase 요약

| Phase | 이름 | 목표 | 예상 기간 |
|-------|------|------|----------|
| 1 | PoC - 핵심 루프 | 이슈 하나를 수동 입력 받아 Plan 생성 -> 구현 -> 커밋까지 동작 증명 | 3~5일 |
| 2 | 기본 파이프라인 | 전체 파이프라인 흐름 (이슈 -> 워크트리 -> 구현 -> PR) 완성 | 5~7일 |
| 3 | 품질 계층 | 3라운드 리뷰, 코드 간소화, 최종 검증 추가 | 3~5일 |
| 4 | 안전장치 | 모든 safety guard, 타임아웃, 롤백, 모니터링 | 3~5일 |
| 5 | 자동화 | Webhook 수신, 대시보드, 운영 도구 | 5~7일 |

---

## Phase 1: PoC - 핵심 루프

### 목표

GitHub 이슈 번호를 CLI 인자로 받아, Plan 생성 -> Phase별 구현 -> 커밋까지 일관된 루프가 동작하는 것을 증명한다. PR 생성이나 리뷰 없이, 코드가 실제로 생성되고 커밋되는 것만 확인한다.

### 구현 항목

| # | 모듈 | 파일 경로 | 설명 |
|---|------|----------|------|
| 1 | 프로젝트 초기화 | `package.json`, `tsconfig.json`, `.eslintrc.json` | TypeScript + ESLint + vitest 설정. ESM 모듈 방식 |
| 2 | 설정 로더 | `src/config/loader.ts` | config.yml 파싱, 기본값 병합, 필수 필드 검증. 이 Phase에서는 `general`, `git`, `commands` 섹션만 구현 |
| 3 | 설정 타입 | `src/types/config.ts` | AQConfig 인터페이스 전체 정의 (향후 확장을 위해 전체 타입은 미리 정의) |
| 4 | 이슈 패처 | `src/github/issue-fetcher.ts` | `gh issue view {number} --json title,body,labels` 호출하여 이슈 정보 반환. `GhCliRunner` 유틸 사용 |
| 5 | CLI 러너 | `src/utils/cli-runner.ts` | `child_process.execFile` 래퍼. timeout, stdout/stderr 캡처, 에러 처리 포함 |
| 6 | 템플릿 렌더러 | `src/prompt/template-renderer.ts` | `{{variable}}` 치환 함수. 중첩 변수(`{{a.b}}`) 지원 |
| 7 | Claude 러너 | `src/claude/claude-runner.ts` | Claude CLI 호출, 프롬프트 전달, JSON 응답 파싱. `--print --output-format json` 모드 사용 |
| 8 | Plan 생성기 | `src/pipeline/plan-generator.ts` | plan-generation.md 템플릿 렌더링 -> Claude 호출 -> Plan JSON 파싱/검증 |
| 9 | Phase 실행기 | `src/pipeline/phase-executor.ts` | phase-implementation.md 템플릿 렌더링 -> Claude 호출 -> 결과 파싱. git 커밋은 Claude가 프롬프트 내 지시에 따라 수행 |
| 10 | 메인 루프 | `src/pipeline/core-loop.ts` | Plan 생성 -> Phase 순회 -> 각 Phase 실행 -> 결과 수집 |
| 11 | CLI 엔트리 | `src/cli.ts` | `npx tsx src/cli.ts --issue 42 --repo owner/repo` 형태의 진입점 |
| 12 | 프롬프트 파일 | `prompts/plan-generation.md`, `prompts/phase-implementation.md` | 문서 5의 템플릿 1, 2 |
| 13 | 테스트 | `tests/config/loader.test.ts`, `tests/prompt/template-renderer.test.ts`, `tests/pipeline/plan-generator.test.ts` | 단위 테스트. Claude 호출은 mock |

### 완료 기준

```
1. `npx tsx src/cli.ts --issue 42 --repo owner/repo` 실행 시:
   a. GitHub에서 이슈 정보를 가져온다
   b. Plan JSON이 생성되어 logs/에 저장된다
   c. 각 Phase에 대해 Claude CLI가 호출된다
   d. Phase별 커밋이 작업 브랜치에 생성된다
   e. 최종 결과 JSON이 stdout에 출력된다

2. `npm test` 통과 (최소 10개 테스트)
3. `npx tsc --noEmit` 통과
4. `npm run lint` 통과
```

### 예상 의존성

```json
{
  "dependencies": {
    "yaml": "^2.3.0",
    "lodash-es": "^4.17.21",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "tsx": "^4.7.0",
    "vitest": "^1.3.0",
    "@types/node": "^20.11.0",
    "@types/lodash-es": "^4.17.12",
    "eslint": "^8.57.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0"
  }
}
```

### Phase 1 디렉토리 구조

```
AI-Quartermaster/
  config.yml
  package.json
  tsconfig.json
  .eslintrc.json
  src/
    cli.ts
    types/
      config.ts
    config/
      loader.ts
      defaults.ts
      validator.ts
    utils/
      cli-runner.ts
      logger.ts
    github/
      issue-fetcher.ts
    prompt/
      template-renderer.ts
    claude/
      claude-runner.ts
    pipeline/
      core-loop.ts
      plan-generator.ts
      phase-executor.ts
  prompts/
    plan-generation.md
    phase-implementation.md
  tests/
    config/
      loader.test.ts
    prompt/
      template-renderer.test.ts
    pipeline/
      plan-generator.test.ts
  logs/
    .gitkeep
```

---

## Phase 2: 기본 파이프라인

### 목표

이슈 입력부터 Draft PR 생성까지 전체 파이프라인이 동작한다. 워크트리 격리, 브랜치 관리, PR 생성이 추가된다.

### 구현 항목

| # | 모듈 | 파일 경로 | 설명 |
|---|------|----------|------|
| 1 | 브랜치 매니저 | `src/git/branch-manager.ts` | 베이스 브랜치 결정, 최신 fetch, 작업 브랜치 생성. `git.branchTemplate` 기반 네이밍 |
| 2 | 슬러그 생성기 | `src/utils/slug.ts` | 이슈 제목에서 URL-safe 슬러그 생성. 한글 제거, 특수문자 제거, 최대 50자 |
| 3 | 워크트리 매니저 | `src/git/worktree-manager.ts` | `git worktree add` / `git worktree remove` 래퍼. 워크트리 생성, 정리, 목록 조회 |
| 4 | 의존성 설치기 | `src/pipeline/dependency-installer.ts` | 워크트리 생성 후 `commands.preInstall` 실행 |
| 5 | PR 생성기 | `src/github/pr-creator.ts` | `gh pr create --draft --title ... --body ...` 호출. PR 본문 템플릿 렌더링 |
| 6 | PR 본문 템플릿 | `prompts/pr-body.md` | PR 본문 마크다운 템플릿. Plan 요약, Phase 목록, 변경 파일, 테스트 결과 포함 |
| 7 | 파이프라인 오케스트레이터 | `src/pipeline/orchestrator.ts` | 전체 흐름 조율: 이슈 fetch -> 브랜치 생성 -> 워크트리 생성 -> 의존성 설치 -> core-loop -> PR 생성 -> 워크트리 정리 |
| 8 | 파이프라인 상태 | `src/types/pipeline.ts` | `PipelineState`, `PipelineResult`, `PhaseResult` 등 파이프라인 상태 타입 |
| 9 | 결과 리포터 | `src/pipeline/result-reporter.ts` | 파이프라인 결과를 JSON + 사람 읽기 좋은 형태로 출력 |
| 10 | 설정 로더 확장 | `src/config/loader.ts` | `worktree`, `pr` 섹션 로딩 추가 |
| 11 | 테스트 | `tests/git/branch-manager.test.ts`, `tests/git/worktree-manager.test.ts`, `tests/github/pr-creator.test.ts`, `tests/pipeline/orchestrator.test.ts` | 단위 + 통합 테스트 |

### 완료 기준

```
1. `npx tsx src/cli.ts --issue 42 --repo owner/repo` 실행 시:
   a. 이슈 정보 fetch
   b. `ax/42-some-slug` 형태의 브랜치 생성
   c. 워크트리 격리 환경에서 구현 실행
   d. 모든 Phase 커밋 완료
   e. Draft PR 생성됨 (GitHub에서 확인 가능)
   f. 워크트리 정리됨

2. 워크트리가 메인 저장소와 독립적으로 동작함 (파일 변경이 메인에 영향 없음)
3. PR 본문에 Plan 요약, Phase 목록, 변경 파일 목록이 포함됨
4. `npm test` 통과 (최소 25개 테스트)
```

### 예상 의존성

Phase 1 의존성 + 추가 없음 (gh CLI는 시스템에 설치되어 있다고 가정)

---

## Phase 3: 품질 계층

### 목표

3라운드 리뷰, 코드 간소화, 최종 검증을 추가하여 생성 코드의 품질을 보장한다.

### 구현 항목

| # | 모듈 | 파일 경로 | 설명 |
|---|------|----------|------|
| 1 | 리뷰 라운드 실행기 | `src/review/review-runner.ts` | 리뷰 프롬프트 렌더링 -> Claude 호출 -> 결과 파싱 -> PASS/FAIL 판정 |
| 2 | 리뷰 오케스트레이터 | `src/review/review-orchestrator.ts` | config의 `review.rounds` 배열을 순회하며 각 라운드 실행. `failAction`에 따라 retry/warn/block 처리 |
| 3 | 간소화 실행기 | `src/review/simplify-runner.ts` | review-round3-simplify.md 실행. 간소화 적용 후 테스트 재실행, 실패 시 롤백 |
| 4 | 최종 검증기 | `src/pipeline/final-validator.ts` | 전체 파이프라인 완료 후 최종 검증: 빌드, 테스트, 린트, 타입체크 모두 실행. diff 통계 확인 |
| 5 | 리뷰 프롬프트 | `prompts/review-round1.md`, `prompts/review-round2.md`, `prompts/review-round3-simplify.md` | 문서 5의 템플릿 3, 4, 5 |
| 6 | diff 수집기 | `src/git/diff-collector.ts` | `git diff base...HEAD` 실행, 변경 파일 목록, 추가/삭제 라인 수 집계 |
| 7 | 리뷰 결과 타입 | `src/types/review.ts` | `ReviewResult`, `ReviewFinding`, `SimplifyResult` 타입 정의 |
| 8 | 오케스트레이터 확장 | `src/pipeline/orchestrator.ts` | core-loop 이후 review-orchestrator 호출 -> simplify -> final-validator 호출 추가 |
| 9 | 테스트 | `tests/review/review-runner.test.ts`, `tests/review/review-orchestrator.test.ts`, `tests/pipeline/final-validator.test.ts` | 리뷰 PASS/FAIL 시나리오, retry 로직, 롤백 로직 테스트 |

### 완료 기준

```
1. 구현 완료 후 3라운드 리뷰가 자동 실행됨
   a. 라운드 1 FAIL 시: 최대 2회 재시도 후 여전히 FAIL이면 파이프라인 중단
   b. 라운드 2 FAIL 시: WARN 로그 후 계속 진행
   c. 라운드 3: 간소화 적용 후 테스트 통과 확인, 실패 시 롤백

2. 최종 검증에서 빌드/테스트/린트/타입체크 모두 통과해야 PR 생성 진행

3. PR 본문에 리뷰 결과 요약이 포함됨:
   - 각 라운드 PASS/FAIL
   - 주요 finding 목록
   - 간소화 결과 (제거된 라인 수)

4. `npm test` 통과 (최소 40개 테스트)
```

### 예상 의존성

Phase 2 의존성 + 추가 없음

---

## Phase 4: 안전장치

### 목표

프로덕션 운영에 필요한 모든 안전장치를 추가한다. 민감 파일 보호, 타임아웃, 변경량 제한, 롤백 메커니즘을 구현한다.

### 구현 항목

| # | 모듈 | 파일 경로 | 설명 |
|---|------|----------|------|
| 1 | 민감 경로 가드 | `src/safety/sensitive-path-guard.ts` | `safety.sensitivePaths` glob 패턴과 실제 변경 파일을 비교. 매치 시 즉시 중단 |
| 2 | 변경량 가드 | `src/safety/change-limit-guard.ts` | `maxFileChanges`, `maxInsertions`, `maxDeletions` 초과 시 중단 |
| 3 | 타임아웃 관리자 | `src/safety/timeout-manager.ts` | 각 단계별 타임아웃 + 전체 파이프라인 타임아웃. `AbortController` 기반 |
| 4 | 베이스 브랜치 보호 | `src/safety/base-branch-guard.ts` | 현재 브랜치가 베이스 브랜치가 아닌지 검증, 베이스 브랜치로의 직접 push 시도 차단 |
| 5 | Phase 수 제한 | `src/safety/phase-limit-guard.ts` | Plan의 phase 수가 `maxPhases` 초과 시 Plan 재생성 요청 또는 중단 |
| 6 | 롤백 매니저 | `src/safety/rollback-manager.ts` | Phase 실행 전 체크포인트(커밋 해시) 저장, 실패 시 해당 커밋으로 `git reset --hard` |
| 7 | 이슈 라벨 필터 | `src/safety/label-filter.ts` | `allowedLabels` 설정에 따라 처리 가능한 이슈인지 확인 |
| 8 | 중단 조건 감시기 | `src/safety/stop-condition-watcher.ts` | Claude 출력에서 `stopConditions` 패턴 매칭, 감지 시 즉시 중단 |
| 9 | 안전 검증 통합 | `src/safety/safety-checker.ts` | 위 모든 가드를 통합 실행하는 파사드. 파이프라인 각 단계 전후에 호출 |
| 10 | 오케스트레이터 확장 | `src/pipeline/orchestrator.ts` | 각 단계 전후에 safety-checker 호출 삽입 |
| 11 | 에러 분류 | `src/types/errors.ts` | `SafetyViolationError`, `TimeoutError`, `RollbackError` 등 커스텀 에러 클래스 |
| 12 | 테스트 | `tests/safety/sensitive-path-guard.test.ts`, `tests/safety/change-limit-guard.test.ts`, `tests/safety/timeout-manager.test.ts`, `tests/safety/rollback-manager.test.ts` | 각 가드의 차단/허용 시나리오 테스트 |

### 완료 기준

```
1. 민감 파일 수정 시도 시:
   - 파이프라인 즉시 중단
   - 에러 로그에 어떤 파일이 문제인지 명시
   - 워크트리에 변경사항 커밋되지 않음

2. 타임아웃 동작:
   - Phase 구현이 300초 초과 시 해당 Phase 중단
   - 전체 파이프라인이 1시간 초과 시 전체 중단
   - 중단 시 현재까지의 결과 보존

3. 변경량 초과 시:
   - maxFileChanges(30) 초과: 경고 후 중단
   - maxInsertions(2000) 초과: 경고 후 중단

4. 롤백 동작:
   - Phase 실패 시 이전 커밋으로 자동 롤백
   - 롤백 후 다음 Phase 시도 또는 중단 (maxRetries 기반)

5. `npm test` 통과 (최소 60개 테스트)
```

### 예상 의존성

Phase 3 의존성 + 추가:

```json
{
  "dependencies": {
    "minimatch": "^9.0.0"
  }
}
```

(`minimatch`는 glob 패턴 매칭용)

---

## Phase 5: 자동화

### 목표

GitHub Webhook으로 이슈 이벤트를 자동 수신하고, 대시보드에서 파이프라인 상태를 모니터링할 수 있다.

### 구현 항목

| # | 모듈 | 파일 경로 | 설명 |
|---|------|----------|------|
| 1 | Webhook 서버 | `src/server/webhook-server.ts` | Express 또는 Hono 기반 HTTP 서버. `/webhook` 엔드포인트에서 GitHub webhook 수신 |
| 2 | Webhook 검증 | `src/server/webhook-validator.ts` | `X-Hub-Signature-256` 헤더로 webhook 페이로드 HMAC 검증 |
| 3 | 이벤트 디스패처 | `src/server/event-dispatcher.ts` | webhook 이벤트 타입별 분기. `issues.labeled` 이벤트에서 파이프라인 트리거 |
| 4 | 작업 큐 | `src/queue/job-queue.ts` | 인메모리 FIFO 큐. concurrency 설정에 따라 동시 실행 제한. 실패 시 재시도 로직 |
| 5 | 작업 상태 저장 | `src/queue/job-store.ts` | 파이프라인 실행 상태를 JSON 파일로 저장. 상태: `queued`, `running`, `success`, `failure`, `cancelled` |
| 6 | 대시보드 API | `src/server/dashboard-api.ts` | REST API: `GET /api/jobs` (목록), `GET /api/jobs/:id` (상세), `POST /api/jobs/:id/cancel` (취소) |
| 7 | 대시보드 UI | `src/server/public/index.html` | 단일 HTML 파일 + 인라인 JS. 작업 목록, 상태, 로그 실시간 표시. SSE(Server-Sent Events)로 실시간 업데이트 |
| 8 | 알림 발송기 | `src/notification/notifier.ts` | 파이프라인 완료/실패 시 GitHub 이슈에 코멘트 작성. `gh issue comment` 사용 |
| 9 | 헬스체크 | `src/server/health.ts` | `GET /health` 엔드포인트. 서버 상태, 큐 상태, 디스크 공간 확인 |
| 10 | 프로세스 매니저 | `src/cli.ts` 확장 | `start` (서버 모드), `run` (단건 실행), `status` (상태 확인), `cleanup` (오래된 워크트리 정리) 서브커맨드 |
| 11 | 워크트리 정리기 | `src/git/worktree-cleaner.ts` | `worktree.maxAge` 초과 워크트리 자동 정리. cron 또는 서버 시작 시 실행 |
| 12 | 설정 검증 강화 | `src/config/validator.ts` | 서버 모드 전용 필드 검증 (webhook secret 필수 등) |
| 13 | 테스트 | `tests/server/webhook-validator.test.ts`, `tests/queue/job-queue.test.ts`, `tests/server/event-dispatcher.test.ts` | Webhook 검증, 큐 동작, 이벤트 분기 테스트 |

### 완료 기준

```
1. Webhook 동작:
   - GitHub에서 이슈에 "aqm" 라벨 추가 시 webhook 수신
   - 페이로드 HMAC 검증 통과
   - 파이프라인 자동 트리거

2. 큐 동작:
   - 동시 실행 제한 (concurrency 설정값)
   - 큐에 대기 중인 작업 확인 가능
   - 실행 중 작업 취소 가능

3. 대시보드:
   - http://localhost:3000 접속 시 작업 목록 표시
   - 각 작업의 상태, 시작 시간, 소요 시간, 결과 확인 가능
   - 실시간 상태 업데이트 (SSE)

4. 알림:
   - 파이프라인 성공 시 이슈에 "PR 생성 완료" 코멘트
   - 파이프라인 실패 시 이슈에 실패 원인 코멘트

5. CLI:
   - `npx tsx src/cli.ts start` -> 서버 시작
   - `npx tsx src/cli.ts run --issue 42 --repo owner/repo` -> 단건 실행
   - `npx tsx src/cli.ts status` -> 현재 큐 상태 출력
   - `npx tsx src/cli.ts cleanup` -> 오래된 워크트리 정리

6. `npm test` 통과 (최소 80개 테스트)
```

### 예상 의존성

Phase 4 의존성 + 추가:

```json
{
  "dependencies": {
    "hono": "^4.1.0",
    "@hono/node-server": "^1.8.0"
  }
}
```

---

## Phase 간 의존성 그래프

```
Phase 1: PoC - 핵심 루프
  ├── config/loader.ts
  ├── types/config.ts
  ├── utils/cli-runner.ts
  ├── github/issue-fetcher.ts
  ├── prompt/template-renderer.ts
  ├── claude/claude-runner.ts
  ├── pipeline/plan-generator.ts
  ├── pipeline/phase-executor.ts
  └── pipeline/core-loop.ts
         │
         ▼
Phase 2: 기본 파이프라인
  ├── git/branch-manager.ts        (← utils/cli-runner.ts)
  ├── git/worktree-manager.ts      (← utils/cli-runner.ts)
  ├── utils/slug.ts
  ├── pipeline/dependency-installer.ts (← utils/cli-runner.ts)
  ├── github/pr-creator.ts         (← utils/cli-runner.ts, prompt/template-renderer.ts)
  └── pipeline/orchestrator.ts     (← 모든 Phase 1 + Phase 2 모듈)
         │
         ▼
Phase 3: 품질 계층
  ├── review/review-runner.ts      (← claude/claude-runner.ts, prompt/template-renderer.ts)
  ├── review/review-orchestrator.ts (← review/review-runner.ts)
  ├── review/simplify-runner.ts    (← claude/claude-runner.ts)
  ├── git/diff-collector.ts        (← utils/cli-runner.ts)
  └── pipeline/final-validator.ts  (← utils/cli-runner.ts)
         │
         ▼
Phase 4: 안전장치
  ├── safety/sensitive-path-guard.ts
  ├── safety/change-limit-guard.ts (← git/diff-collector.ts)
  ├── safety/timeout-manager.ts
  ├── safety/base-branch-guard.ts
  ├── safety/phase-limit-guard.ts
  ├── safety/rollback-manager.ts   (← utils/cli-runner.ts)
  ├── safety/label-filter.ts
  ├── safety/stop-condition-watcher.ts
  └── safety/safety-checker.ts     (← 모든 safety 모듈)
         │
         ▼
Phase 5: 자동화
  ├── server/webhook-server.ts
  ├── server/webhook-validator.ts
  ├── server/event-dispatcher.ts   (← pipeline/orchestrator.ts)
  ├── queue/job-queue.ts
  ├── queue/job-store.ts
  ├── server/dashboard-api.ts      (← queue/job-store.ts)
  ├── server/public/index.html
  ├── notification/notifier.ts     (← utils/cli-runner.ts)
  └── server/health.ts
```

---

## 최종 디렉토리 구조 (Phase 5 완료 시)

```
AI-Quartermaster/
  config.yml
  config.local.yml              # gitignore
  package.json
  tsconfig.json
  .eslintrc.json
  .gitignore
  src/
    cli.ts                      # CLI 엔트리포인트
    types/
      config.ts                 # 설정 타입
      pipeline.ts               # 파이프라인 상태 타입
      review.ts                 # 리뷰 결과 타입
      errors.ts                 # 커스텀 에러 클래스
    config/
      loader.ts                 # 설정 로더
      defaults.ts               # 기본값 정의
      validator.ts              # 설정 검증
    utils/
      cli-runner.ts             # 외부 명령어 실행 유틸
      slug.ts                   # 슬러그 생성
      logger.ts                 # 로거
    github/
      issue-fetcher.ts          # 이슈 정보 조회
      pr-creator.ts             # PR 생성
    git/
      branch-manager.ts         # 브랜치 관리
      worktree-manager.ts       # 워크트리 관리
      worktree-cleaner.ts       # 워크트리 정리
      diff-collector.ts         # diff 수집
    prompt/
      template-renderer.ts      # 템플릿 변수 치환
    claude/
      claude-runner.ts          # Claude CLI 호출
    pipeline/
      core-loop.ts              # Plan -> Phase 루프
      plan-generator.ts         # Plan 생성
      phase-executor.ts         # Phase 실행
      orchestrator.ts           # 전체 파이프라인 조율
      dependency-installer.ts   # 의존성 설치
      final-validator.ts        # 최종 검증
      result-reporter.ts        # 결과 출력
    review/
      review-runner.ts          # 리뷰 라운드 실행
      review-orchestrator.ts    # 리뷰 라운드 순회
      simplify-runner.ts        # 코드 간소화
    safety/
      sensitive-path-guard.ts   # 민감 경로 가드
      change-limit-guard.ts     # 변경량 가드
      timeout-manager.ts        # 타임아웃 관리
      base-branch-guard.ts      # 베이스 브랜치 보호
      phase-limit-guard.ts      # Phase 수 제한
      rollback-manager.ts       # 롤백 관리
      label-filter.ts           # 이슈 라벨 필터
      stop-condition-watcher.ts # 중단 조건 감시
      safety-checker.ts         # 통합 안전 검증
    server/
      webhook-server.ts         # Webhook HTTP 서버
      webhook-validator.ts      # Webhook 페이로드 검증
      event-dispatcher.ts       # 이벤트 분기
      dashboard-api.ts          # 대시보드 REST API
      health.ts                 # 헬스체크
      public/
        index.html              # 대시보드 UI
    queue/
      job-queue.ts              # 작업 큐
      job-store.ts              # 작업 상태 저장
    notification/
      notifier.ts               # 알림 발송
  prompts/
    plan-generation.md
    phase-implementation.md
    review-round1.md
    review-round2.md
    review-round3-simplify.md
    pr-body.md
  tests/
    config/
      loader.test.ts
    prompt/
      template-renderer.test.ts
    pipeline/
      plan-generator.test.ts
      orchestrator.test.ts
    git/
      branch-manager.test.ts
      worktree-manager.test.ts
    github/
      pr-creator.test.ts
    review/
      review-runner.test.ts
      review-orchestrator.test.ts
    safety/
      sensitive-path-guard.test.ts
      change-limit-guard.test.ts
      timeout-manager.test.ts
      rollback-manager.test.ts
    server/
      webhook-validator.test.ts
      event-dispatcher.test.ts
    queue/
      job-queue.test.ts
  logs/
    .gitkeep
  data/
    jobs/                       # 작업 상태 JSON 파일
      .gitkeep
```

---

## 위험 요소 및 대응

| 위험 | 영향 | 대응 |
|------|------|------|
| Claude CLI 응답이 유효한 JSON이 아닐 수 있음 | Plan/리뷰 파싱 실패 | JSON 추출 정규식으로 응답에서 JSON 블록만 추출. 최대 3회 재시도 |
| Claude가 프롬프트 범위를 벗어난 파일을 수정할 수 있음 | 안전장치 우회 | Phase 실행 전후 diff 비교로 변경 파일 목록 검증. 범위 밖 파일 변경 시 롤백 |
| 워크트리 누적으로 디스크 공간 부족 | 서버 중단 | worktree-cleaner 정기 실행 + 헬스체크에 디스크 공간 확인 포함 |
| 동시 실행 시 같은 이슈를 중복 처리 | 브랜치 충돌 | job-queue에 이슈 번호 기반 중복 방지 로직 |
| GitHub API rate limit | 이슈 fetch/PR 생성 실패 | gh CLI의 기본 rate limit 처리에 의존 + 지수 백오프 재시도 |
