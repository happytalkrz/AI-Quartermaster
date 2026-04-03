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

## 이전 시도 출력 로그

{{retry.lastOutput}}이(가) 있는 경우, 이전 시도의 전체 출력을 참고하여 문제를 파악하세요:

```
{{retry.lastOutput}}
```

---

## 진행 보고 (필수)

작업 중 2분마다 현재 진행 상황을 한 줄로 출력하세요. 형식:
`[HEARTBEAT] Phase {{phase.index}} fix: <현재 하고 있는 작업>`

**출력이 5분간 없으면 시스템이 작업을 중단합니다.**

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
