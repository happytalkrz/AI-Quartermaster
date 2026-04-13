# AI Quartermaster (AQM)

GitHub Issue를 받아 Claude CLI로 자동 구현하고 Draft PR을 생성하는 파이프라인 자동화 도구.

**Tech Stack:** TypeScript (strict, ES2022, ESM) | Node.js 20+ | Hono | Zod | Vitest | YAML config

---

## ⛔ CRITICAL RULES (Level 1: MUST)

### Build & Verify
- ✅ `npx tsc --noEmit` 통과 필수. 타입 에러 남기지 않는다.
- ✅ `npx vitest run` 전체 통과 확인 후 작업 완료.
- ✅ import는 `.js` 확장자 포함 (ESM).

### Config 변경
- ⛔ 새 config 필드 추가 시 **반드시 3곳 동시 수정**: `types/config.ts`, `config/defaults.ts`, `config/validator.ts`

### Safety
- ❌ 안전장치 우회 금지. safety guard를 비활성화하는 코드 작성하지 않는다.
- ❌ `any` 타입 사용 최소화. 불가피한 경우에만.
- ❌ `git add -f` 절대 금지.

### 디자인 규칙
- ⛔ **UI/대시보드 디자인은 임의로 하지 않는다** — Stitch 디자인 시스템 기반 (`docs/design/` 참조)
- ⛔ 디자인 파일이 없으면 사용자에게 Stitch에서 먼저 받아올 것을 요청

### Skill 참조 (필수)
- ⛔ **코드 작성/수정 작업 전에 관련 스킬 SKILL.md를 반드시 Read하고 규칙을 적용할 것**
- ⛔ **에이전트에 위임 시에도 관련 스킬 내용을 프롬프트에 포함할 것**
- ⛔ **명시 요청이 없어도 아래 키워드에 해당하면 스킬을 로드해야 함**
- 스킬 로드 흐름: (1) 요청의 **의도 키워드** 파악 → (2) 매칭 스킬 **Read** → (3) 적용한 스킬을 답변에서 밝힘

**키워드 → 스킬 매핑:**
| 키워드 (한글/영어) | 필수 로드 스킬 |
|-------------------|--------------|
| 이슈, 이슈 생성, issue | `create-issue` |
| 파이프라인 상태, state machine | `add-pipeline-state` |
| config, 설정 필드 | `add-config` |
| 프롬프트, 템플릿 | `add-prompt` |
| safety, 안전장치 | `add-safety-guard` |
| CLI 명령어, aqm 명령 | `add-cli-command` |
| 워크플랜, 플랜 | `workplan` |
| 컨플릭트, 충돌 해소 | `resolve-conflict` |
| 플랜 실행, 이슈 처리 | `execute-plan` |
| 타입체크, tsc | `typecheck` |
| 테스트, vitest | `test` |
| 린트, eslint | `lint` |
| 검증, 전체확인 | `verify` |

---

## 📋 Pattern Summary (Level 2: References)

### 프로젝트 구조
```
src/
  cli.ts              # CLI 진입점
  pipeline/           # 상태머신 기반 파이프라인
    core/             # orchestrator, core-loop, pipeline-context
    execution/        # phase-executor, phase-retry, phase-scheduler, retry-with-fix
    phases/           # pipeline-phases, pipeline-review, plan-generator, pipeline-publish
    setup/            # pipeline-setup, pipeline-git-setup, feasibility-checker, dependency-installer, pipeline-validation
    reporting/        # result-reporter, progress-tracker, verification-parser, final-validator, pipeline-result-validator
    errors/           # error-classifier, pipeline-error-handler, checkpoint
    automation/       # automation-dispatcher, ci-checker, issue-orchestrator
  queue/              # 잡 큐 (동시성, stuck 감지, JSON 영속화)
  safety/             # 안전장치 (라벨, 경로, 변경제한, 타임아웃)
  config/             # YAML 로더, Zod 검증, hot reload, 프로젝트별 오버라이드
  types/              # 전체 타입 정의
  claude/             # Claude CLI 브릿지
  git/                # worktree, branch 관리
  server/             # Hono 웹훅 서버, 대시보드 API, SSE
  github/             # 이슈 페치, PR 생성
  review/             # 리뷰 + 코드 간소화 + 분할 리뷰
  notification/       # 이슈 코멘트 알림
  prompt/             # 템플릿 렌더러
  update/             # self-updater
  polling/            # 이슈 폴러
  hooks/              # hook-executor, hook-registry (파이프라인 훅 시스템)
  learning/           # pattern-store (실패 패턴 학습)
  store/              # database, queries (SQLite 기반 잡 저장소)
  tasks/              # aqm-task, claude-task, git-task, task-factory, validation-task (태스크 추상화)
  utils/              # CLI 러너, 로거, slug
  setup/              # 셋업 위자드
tests/                # Vitest 테스트
prompts/              # Claude 프롬프트 템플릿
docs/                 # 문서
  design/             # Stitch 디자인 파일 (HTML)
```

### 프롬프트 관리
- 프롬프트 템플릿은 `prompts/` 디렉토리에 md 파일로 관리. 하드코딩 금지.
📖 `.claude/skills/guide/add-prompt/SKILL.md`

### Config 패턴
- 3곳 동시 수정: `types/config.ts` → `config/defaults.ts` → `config/validator.ts`
📖 `.claude/skills/guide/add-config/SKILL.md`

### 파이프라인 상태
- orchestrator.ts는 thin orchestrator (155줄) — 실제 로직은 pipeline-phases.ts, pipeline-review.ts 등에 위임
📖 `.claude/skills/guide/add-pipeline-state/SKILL.md`

---

## 🛠️ Quick Reference

### 커밋 컨벤션
- `feat:` 기능 추가 | `fix:` 버그 수정 | `test:` 테스트 | `docs:` 문서 | `refactor:` 리팩터링
- 한글 커밋 메시지 사용

### Coding Principles
- **YAGNI**: 미래 예측 구현 금지 — 현재 필요한 것만
- **DRY**: 3번 이상 반복될 때만 추상화 고려
- **Surgical Changes**: 내 변경으로 생긴 unused만 정리. 기존 dead code는 삭제하지 않음

---

## 📚 Skills (13개)

**Dev:** `typecheck` | `test` | `lint` | `verify`
**Guide:** `add-pipeline-state` | `add-config` | `add-prompt` | `add-safety-guard` | `add-cli-command`
**Workflow:** `workplan` | `resolve-conflict` | `create-issue` | `execute-plan`

| 작업 | 필수 참조 스킬 |
|-----|--------------|
| 이슈 생성 | `create-issue` |
| 새 config 필드 | `add-config` |
| 파이프라인 상태 추가 | `add-pipeline-state` |
| 프롬프트 템플릿 추가 | `add-prompt` |
| 안전장치 추가 | `add-safety-guard` |
| CLI 명령 추가 | `add-cli-command` |
| 워크플랜 관리 | `workplan`, `execute-plan` |
| 머지 충돌 해소 | `resolve-conflict` |
| 작업 완료 검증 | `verify` |

---

## 워크플랜

진행 상황은 `.claude/doc/workplan/`에서 확인. 각 플랜 파일의 상태 필드가 최신 정보.
