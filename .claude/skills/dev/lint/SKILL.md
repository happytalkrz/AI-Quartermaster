---
name: lint
description: This skill should be used when the user asks to "run lint", "린트", "eslint", "fix lint", "코드 스타일", or mentions lint errors, autofix, code style.
level: 2
---

# ESLint 린트

## 실행

```bash
# 검사만
npx eslint src/ tests/

# 자동 수정
npx eslint src/ tests/ --fix
```

## 프로젝트 설정

`.eslintrc.json`:
- parser: `@typescript-eslint/parser`
- 규칙: TypeScript recommended + strict

## 자동 수정 안전 가이드

`--fix`로 자동 수정 가능한 것:
- 세미콜론, 쉼표, 따옴표 스타일
- import 정렬
- 불필요한 타입 단언

`--fix`로 안 되는 것 (수동 수정):
- `@typescript-eslint/no-explicit-any` — 타입 명시 필요
- `@typescript-eslint/no-unused-vars` — 코드 제거 필요
- `no-console` — logger 사용으로 전환

## 수정 후

린트 수정이 동작을 바꿀 수 있으므로:
```bash
npx tsc --noEmit && npx vitest run
```
