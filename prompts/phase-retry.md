# Phase 재시도

이전 구현 시도가 실패했습니다. 에러를 분석하고 수정하세요.

---

## 이슈 정보

- **이슈**: #{{issue.number}} -- {{issue.title}}

## 현재 Phase

- **Phase**: {{phase.index}}/{{phase.totalCount}} -- {{phase.name}}
- **설명**: {{phase.description}}
- **대상 파일**: {{phase.files}}

## 이전 시도 실패 정보

- **시도 횟수**: {{retry.attempt}}/{{retry.maxRetries}}
- **에러 유형**: {{retry.errorCategory}}
- **에러 메시지**:

```
{{retry.errorMessage}}
```

{{#retry.errorHistory}}
## 에러 히스토리

이전 시도들의 에러 정보를 참고하여 반복적인 실수를 방지하세요:

| 시도 | 에러 유형 | 에러 메시지 (요약) |
|------|-----------|-------------------|
{{#retry.errorHistory}}
| {{attempt}} | {{errorCategory}} | {{errorSummary}} |
{{/retry.errorHistory}}

**주의**: 이전 시도들에서 이미 시도한 접근 방식은 피하고, 근본 원인을 해결하는 다른 방법을 시도하세요.
{{/retry.errorHistory}}

{{#retry.isPartial}}
## 부분 재시도 모드

이전 시도에서 일부 파일은 성공적으로 수정되었고 **이미 커밋되었습니다**. 성공한 변경은 보존되어 있으므로 절대 건드리지 마세요.

### 수정 대상 파일 (실패한 파일만)

아래 파일들만 수정하세요:

```
{{retry.failedFiles}}
```

### 주의사항

- **위 실패 파일들만** 수정하세요. 목록에 없는 파일은 수정하지 마세요.
- 성공한 변경사항은 이미 커밋되어 있습니다 — 다시 수정하면 중복 변경이 됩니다.
- 각 실패 파일의 에러 원인을 분석하고 해당 파일만 정밀하게 수정하세요.
{{/retry.isPartial}}

## 이전 시도 출력 로그

이전 시도의 전체 출력을 참고하여 문제를 파악하세요:

```
{{retry.lastOutput}}
```

---

## 진행 보고 (필수)

작업 중 2분마다 현재 진행 상황을 한 줄로 출력하세요. 형식:
`[HEARTBEAT] Phase {{phase.index}} fix: <현재 하고 있는 작업>`

**출력이 5분간 없으면 시스템이 작업을 중단합니다.**

{{phase.buildStatus}}

## 변경 범위 제한 규칙 (필수 — 위반 시 작업 실패로 간주)

**이 규칙들은 다른 어떤 판단보다 우선합니다.**

1. **이슈에서 명시적으로 요청한 파일만 생성/수정하세요.**
   - Phase 대상 파일 목록(`{{phase.files}}`)에 없는 파일은 절대 건드리지 마세요.
   - "관련이 있어 보이는" 파일도 수정하지 마세요. 요청하지 않은 파일은 손대지 않습니다.

2. **기존 tsc/lint 에러는 무시하세요.**
   - 이미 존재하는 TypeScript 컴파일 에러나 ESLint 에러를 발견해도 수정하지 마세요.
   - 내가 새로 추가/수정한 코드에서 발생한 에러만 수정하세요.
   - "빌드를 고쳐야 한다"는 판단으로 범위를 확장하지 마세요.

3. **.tsx 파일이 존재하면 동일한 이름의 .js 파일을 절대 생성하지 마세요.**
   - `foo.tsx`가 있으면 `foo.js`를 만들지 마세요.
   - `.ts` 파일이 있으면 `.js` 복제도 금지입니다.
   - 기존 TypeScript 파일을 JavaScript로 변환하거나 복사하지 마세요.

## 수정 규칙

1. **에러 메시지를 정확히 분석하세요.** 에러가 발생한 파일과 라인을 확인하세요.
2. 이전 시도의 변경사항은 이미 적용되어 있습니다. 에러 부분만 수정하세요.
3. 수정 후 반드시 **git add + git commit**을 수행하세요.
4. 커밋 메시지 형식: `[#{{issue.number}}] Phase {{phase.index}} fix: {{phase.name}}`
5. 수정 후 아래 검증 명령을 실행하세요:
   - 테스트: `{{config.testCommand}}`
   - 린트: `{{config.lintCommand}}`
6. 검증이 실패하면 수정 후 다시 검증하세요.

## 출력

수정 완료 후 아래 JSON을 출력하세요:

```json
{
  "phaseIndex": {{phase.index}},
  "phaseName": "{{phase.name}}",
  "filesModified": ["<수정한 파일 경로>", ...],
  "commitMessage": "<커밋 메시지>",
  "fixDescription": "<무엇을 수정했는지>"
}
```
