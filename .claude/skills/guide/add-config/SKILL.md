---
name: add-config
description: This skill should be used when the user asks to "add config field", "설정 추가", "config 필드 추가", "add setting", or mentions types/config.ts, defaults.ts, validator.ts, Zod schema, AQConfig.
level: 3
---

# 설정 필드 추가

## 핵심 원칙

AQM의 설정 시스템은 **3중 동기화**로 구성된다. 하나라도 빠지면 컴파일 에러 또는 런타임 검증 실패.

## 절차

### 1단계: 타입 정의 (`src/types/config.ts`)

해당 섹션의 interface에 필드 추가. Optional이면 `?` 붙임:
```typescript
export interface SafetyConfig {
  // ... 기존 필드
  newField: number;        // 필수
  optionalField?: string;  // 선택
}
```

**판단 기준**: 모든 프로젝트에 적용되는 값 → 필수. 프로젝트별 다를 수 있는 값 → 선택 또는 ProjectConfig에 오버라이드.

### 2단계: 기본값 (`src/config/defaults.ts`)

DEFAULT_CONFIG의 같은 위치에 기본값 추가:
```typescript
safety: {
  // ... 기존
  newField: 10,
}
```

### 3단계: 검증 (`src/config/validator.ts`)

Zod 스키마에 검증 규칙 추가:
```typescript
const safetyConfigSchema = z.object({
  // ... 기존
  newField: z.number().int().positive(),
});
```

### 4단계 (선택): 프로젝트 오버라이드

프로젝트별 다를 수 있으면 `projectConfigSchema`에도 추가:
```typescript
safety: z.object({
  // ... 기존
  newField: z.number().int().positive(),
}).partial().optional(),
```

### 5단계: 문서화

- `config.example.yml`에 주석과 함께 예시 추가
- 필요 시 `docs/config-schema.md` 갱신

## 검증

```bash
npx tsc --noEmit && npx vitest run tests/config/
```

## 흔한 실수

| 실수 | 증상 | 해결 |
|------|------|------|
| defaults.ts 누락 | 런타임에 undefined | DEFAULT_CONFIG에 추가 |
| validator.ts 누락 | 사용자 config 파싱 시 에러 | Zod 스키마에 추가 |
| Zod 타입 불일치 | `z.number()` vs `string` 타입 | types/config.ts와 동기화 |
| projectConfigSchema 미반영 | 프로젝트 오버라이드 무시됨 | partial 스키마에 추가 |
