---
name: add-safety-guard
description: This skill should be used when the user asks to "add safety guard", "안전장치 추가", "add guard", "검증 추가", or mentions SafetyViolationError, safety-checker, validateBeforePush, sensitive paths.
level: 3
---

# 안전장치 추가

## 현재 안전장치 (8개)

| Guard | 위치 | 검증 시점 |
|-------|------|----------|
| label-filter | validateIssue | 파이프라인 시작 전 |
| phase-limit-guard | validatePlan | Plan 생성 후 |
| base-branch-guard | validateBeforePush | push 직전 |
| sensitive-path-guard | validateBeforePush | push 직전 |
| change-limit-guard | validateBeforePush | push 직전 |
| timeout-manager | 각 단계 | 단계별 타임아웃 |
| stop-condition-watcher | Claude 출력 | Claude 응답 검사 |
| rollback-manager | 실패 시 | 롤백 실행 |

## 추가 절차

### 1. Guard 파일 생성 (`src/safety/<name>-guard.ts`)

```typescript
import { SafetyViolationError } from "../types/errors.js";

export function checkSomething(value: T, config: SafetyConfig): void {
  if (/* 위반 조건 */) {
    throw new SafetyViolationError(
      "something-guard",
      "위반 설명",
      { /* 상세 정보 */ }
    );
  }
}
```

핵심: `SafetyViolationError`를 throw한다. 일반 Error가 아님.

### 2. Safety Checker에 연결 (`src/safety/safety-checker.ts`)

검증 시점에 따라 적절한 함수에 추가:
- `validateIssue()` — 이슈 수준 (라벨, 권한 등)
- `validatePlan()` — Plan 수준 (Phase 수, 복잡도 등)
- `validateBeforePush()` — diff 수준 (파일, 경로, 크기 등)
- `validateClaudeOutput()` — Claude 응답 수준

### 3. Config 필드 추가 (필요 시)

`add-config` 스킬 참고. SafetyConfig에 설정 추가.

### 4. 테스트 작성 (`tests/safety/<name>-guard.test.ts`)

필수 케이스:
- 정상 통과 (위반 없음)
- 위반 감지 → SafetyViolationError throw
- 경계값 (정확히 limit, limit+1)
- 빈 입력 / edge case

## 절대 금지

- 기존 guard를 비활성화하는 코드
- `SafetyViolationError`를 catch해서 삼키는 코드
- config 없이 하드코딩된 임계값
