---
name: typecheck
description: This skill should be used when the user asks to "run typecheck", "check types", "타입체크", "tsc", or mentions TypeScript errors, type safety, ESM import errors, config type mismatch.
level: 2
---

# TypeScript 타입 체크

## 실행

```bash
npx tsc --noEmit
```

## 에러 해결 전략

### ESM import 에러
이 프로젝트는 ESM (`"type": "module"`)이다. import 경로에 반드시 `.js` 확장자를 포함해야 한다.
```typescript
// 틀림
import { foo } from "./bar";
// 맞음
import { foo } from "./bar.js";
```

### Config 타입 불일치
새 필드 추가 시 3곳 동시 수정 필수:
1. `src/types/config.ts` — 인터페이스
2. `src/config/defaults.ts` — 기본값
3. `src/config/validator.ts` — Zod 스키마

하나라도 빠지면 타입 에러 또는 런타임 검증 실패.

### 흔한 패턴
| 에러 | 원인 | 해결 |
|------|------|------|
| `Property does not exist on type` | config/types 확장 누락 | types/config.ts에 필드 추가 |
| `Cannot find module` | .js 확장자 누락 | import 경로에 `.js` 추가 |
| `Type 'X' is not assignable to 'Y'` | Zod 스키마와 타입 불일치 | validator.ts와 config.ts 동기화 |
| `Argument of type 'unknown'` | catch 블록의 error | `errorMessage(error)` 유틸 사용 |

## 수정 후

에러 수정 시 반드시 관련 테스트도 확인:
```bash
npx tsc --noEmit && npx vitest run
```

## Gotchas
- [2026-04-04] ESM import에 `.js` 확장자 빠뜨리는 실수 빈발 — 새 파일 추가 후 import 경로에 `.js` 있는지 항상 확인. `Cannot find module` 에러의 90%가 이 원인
