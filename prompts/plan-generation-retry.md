# Plan 생성 재시도

이전 Plan 생성이 실패했으므로, 실패 정보와 추가 컨텍스트를 바탕으로 더 구체적인 구현 계획(Plan)을 수립하세요.

## 이전 실패 정보

- **실패 횟수**: {{retry.attempt}}/{{retry.maxRetries}}
- **실패 사유**: {{retry.failureReason}}
- **에러 메시지**:

```
{{retry.errorMessage}}
```

{{#retry.previousAttempts}}
### 이전 시도 히스토리

이전 시도들의 실패 정보를 참고하여 반복적인 실수를 방지하세요:

| 시도 | 실패 사유 | 주요 문제점 |
|------|-----------|-------------|
{{#retry.previousAttempts}}
| {{attempt}} | {{failureReason}} | {{problemSummary}} |
{{/retry.previousAttempts}}

**주의**: 이전 시도에서 이미 시도한 접근 방식은 피하고, 근본 원인을 해결하는 다른 방법으로 계획하세요.
{{/retry.previousAttempts}}

## 추가 컨텍스트 정보

Plan 생성 정확도를 높이기 위해 수집된 추가 컨텍스트입니다:

{{#context.functionSignatures}}
### 관련 함수 시그니처

```typescript
{{#context.functionSignatures}}
// {{filePath}}
{{signature}}
{{/context.functionSignatures}}
```
{{/context.functionSignatures}}

{{#context.importRelations}}
### Import 관계

```
{{#context.importRelations}}
{{sourceFile}} -> {{importedModules}}
{{/context.importRelations}}
```
{{/context.importRelations}}

{{#context.typeDefinitions}}
### 타입 정의

```typescript
{{#context.typeDefinitions}}
// {{filePath}}
{{typeDefinition}}
{{/context.typeDefinitions}}
```
{{/context.typeDefinitions}}

{{#context.configPatterns}}
### 설정 파일 패턴

{{#context.configPatterns}}
- **{{fileName}}**: {{description}}
  - 구조: {{structure}}
  - 주요 필드: {{keyFields}}
{{/context.configPatterns}}
{{/context.configPatterns}}

## 개선된 사전 분석

이전 실패를 바탕으로 더 상세한 분석을 수행하세요:

1. **실패 원인 분석**:
   - 이전 실패가 발생한 근본 원인을 파악하세요
   - 누락된 의존성이나 부정확한 파일 경로가 있었는지 확인하세요

2. **코드베이스 재분석** (Explore 에이전트 활용):
   - 위에 제공된 함수 시그니처와 import 관계를 참고하여 더 정확한 분석
   - 비슷한 기능의 구현 패턴을 다시 한번 꼼꼼히 확인
   - 테스트, 타입 정의, 설정 파일의 패턴을 위 컨텍스트와 대조하여 분석

3. **종속성 정밀 분석**:
   - 제공된 import 관계를 바탕으로 파일 간 의존성을 정확히 파악
   - 타입 의존성과 설정 파일 간 연관성을 위 정보를 바탕으로 재검토

4. **구현 전략 재수립**:
   - 이전 실패 사유를 고려하여 더 안정적인 계획 수립
   - Phase 분할 시 위험 요소를 최소화하는 방향으로 조정
   - 제공된 컨텍스트 정보와 일치하는 구현 방향 설정

## retry 전용 JSON 필드

기존 Plan JSON 구조에 다음 필드들이 추가됩니다:

```json
{
  "retryContext": {
    "previousFailures": ["<이전 실패 1>", "<이전 실패 2>", ...],
    "mitigations": ["<실패 방지 방안 1>", "<실패 방지 방안 2>", ...],
    "addedPrecautions": ["<추가 예방 조치 1>", "<추가 예방 조치 2>", ...]
  },
  "phases": [
    {
      "riskMitigation": ["<이 Phase에서의 리스크 완화 방안>", ...]
    }
  ]
}
```

### retry 관련 제약사항

- 각 Phase는 이전 실패 요인을 고려한 검증 전략을 포함해야 합니다.
- 이전 실패가 있었다면 병렬성보다는 안정성을 우선하여 의존성을 더 보수적으로 설정하세요.
- **이전 실패 반복 방지**: 제공된 실패 정보와 컨텍스트를 바탕으로 동일한 실수를 반복하지 않는 계획을 수립하세요.