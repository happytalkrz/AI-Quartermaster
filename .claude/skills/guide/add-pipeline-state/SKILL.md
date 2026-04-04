---
name: add-pipeline-state
description: This skill should be used when the user asks to "add pipeline state", "파이프라인 단계 추가", "add stage", "상태 추가", or mentions PipelineState, orchestrator state machine, state transition.
level: 3
---

# 파이프라인 상태 추가

## 상태머신 구조

```
RECEIVED → VALIDATED → BASE_SYNCED → BRANCH_CREATED → WORKTREE_CREATED
→ PLAN_GENERATED → (REVIEWING) → (SIMPLIFYING) → FINAL_VALIDATING
→ DRAFT_PR_CREATED → DONE
(모든 단계 → FAILED)
```

## 새 상태 추가 절차

### 1. 타입 정의 (`src/types/pipeline.ts`)
```typescript
export type PipelineState =
  | "RECEIVED"
  // ... 기존
  | "NEW_STATE"   // 추가
  | "FAILED";
```

### 2. Orchestrator에 상태 전환 추가 (`src/pipeline/orchestrator.ts`)
기존 상태 전환 사이에 새 블록 삽입:
```typescript
// === NEW_STATE ===
state = "NEW_STATE";
logger.info("[NEW_STATE] ...");
jl?.setStep("...");
// 실제 로직
```

### 3. 실패 처리
orchestrator의 catch 블록이 자동으로 FAILED를 처리한다. 단, 새 상태에서 생성한 리소스의 정리(cleanup)는 직접 추가해야 한다.

## 판단 기준

| 변경 유형 | 방법 |
|----------|------|
| 기존 단계에 로직 추가 | 상태 추가 불필요, 해당 블록에 코드 추가 |
| 독립적인 새 단계 | 새 상태 추가 |
| 조건부 단계 (review처럼) | 상태 추가 + preset/config으로 skip 제어 |

## 검증

```bash
npx tsc --noEmit && npx vitest run tests/pipeline/orchestrator.test.ts
```

orchestrator 테스트의 mock 체인도 새 상태에 맞게 갱신해야 한다.
