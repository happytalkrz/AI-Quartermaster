---
name: verify
description: This skill should be used when the user asks to "verify all", "전체 검증", "check everything", "검증해봐", or mentions typecheck + test + lint combined validation.
level: 2
---

# 전체 검증

## 실행

```bash
npx tsc --noEmit && npx vitest run && npx eslint src/ tests/
```

## 검증 순서와 이유

1. **타입체크 먼저** — 타입 에러가 있으면 테스트가 의미 없음
2. **테스트** — 로직 정합성 확인
3. **린트** — 스타일은 마지막 (자동 수정 가능)

## 작업 완료 기준

모든 작업은 이 3가지를 통과해야 완료:
- `tsc --noEmit` : 0 errors
- `vitest run` : 모든 테스트 pass (현재 104개)
- `eslint` : 0 errors (warning은 허용)

## 실패 시 대응

| 단계 | 실패 | 대응 |
|------|------|------|
| tsc | 타입 에러 | 소스 수정 → tsc 재실행 |
| vitest | 테스트 실패 | mock/소스 수정 → vitest 재실행 → tsc 재확인 |
| eslint | 린트 에러 | `--fix`로 자동 수정 → 수동 수정 → tsc+vitest 재확인 |

한 단계를 수정하면 이전 단계부터 다시 실행하여 회귀 방지.
