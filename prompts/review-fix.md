# 리뷰 수정

리뷰에서 발견된 이슈들을 분석하고 수정하세요.

---

## 이슈 정보

- **이슈**: #{{issue.number}} — {{issue.title}}

## 현재 Phase

- **Phase**: {{phase.index}}/{{phase.totalCount}} — {{phase.name}}
- **설명**: {{phase.description}}
- **대상 파일**: {{phase.files}}

## 리뷰 실패 정보

- **수정 시도**: {{fixAttempt.attempt}}/{{fixAttempt.maxAttempts}}

### Analyst 이슈 (해당하는 경우)
{{#if analystFindings}}
{{#each analystFindings}}
**[{{severity}}]** {{type}} - {{requirement}}
- **메시지**: {{message}}
- **제안**: {{suggestion}}
{{#if implementation}}
- **현재 구현**: {{implementation}}
{{/if}}

{{/each}}
{{/if}}

### 리뷰 이슈
{{#each reviewFindings}}
**[{{severity}}]** {{file}}{{#if line}}:{{line}}{{/if}}
- **메시지**: {{message}}
{{#if suggestion}}
- **제안**: {{suggestion}}
{{/if}}

{{/each}}

---

## 진행 보고 (필수)

작업 중 2분마다 현재 진행 상황을 한 줄로 출력하세요. 형식:
`[HEARTBEAT] Phase {{phase.index}} review fix: <현재 하고 있는 작업>`

**출력이 5분간 없으면 시스템이 작업을 중단합니다.**

## 수정 규칙

1. **위에 나열된 모든 이슈를 해결하세요.** error 및 warning 우선 처리.
2. **각 이슈의 제안사항을 참고하여** 구체적이고 정확한 수정을 수행하세요.
3. **기능은 반드시 유지**하세요. 기존 동작을 변경하지 마세요.
4. **이슈 요구사항을 만족**시키면서 리뷰 지적사항을 해결하세요.
5. 수정 후 반드시 **git add + git commit**을 수행하세요.
6. 커밋 메시지 형식: `[#{{issue.number}}] Phase {{phase.index}}: 리뷰 수정 (시도 {{fixAttempt.attempt}})`
7. 수정 후 아래 검증 명령을 실행하세요:
   - 테스트: `{{config.testCommand}}`
   - 린트: `{{config.lintCommand}}`
8. 검증이 실패하면 수정 후 다시 검증하세요.

## 수정 가이드

### Error 수준 이슈
- 즉시 수정 필요
- 기능 동작에 영향을 주는 문제
- 보안 취약점

### Warning 수준 이슈
- 코드 품질 개선 필요
- 잠재적 문제
- 컨벤션 불일치

### Info 수준 이슈
- 선택적 개선사항
- 코드 가독성 향상
- 베스트 프랙티스 적용

## 출력

수정 완료 후 아래 JSON을 출력하세요:

```json
{
  "phaseIndex": {{phase.index}},
  "phaseName": "{{phase.name}}",
  "fixAttempt": {{fixAttempt.attempt}},
  "filesModified": ["<수정한 파일 경로>", ...],
  "issuesFixed": [
    {
      "type": "analyst" | "review",
      "severity": "error" | "warning" | "info",
      "file": "<파일 경로>",
      "message": "<원본 이슈 메시지>",
      "fixDescription": "<어떻게 수정했는지>"
    }
  ],
  "commitMessage": "<커밋 메시지>",
  "testsPass": true | false,
  "summary": "<전체 수정 요약>"
}
```