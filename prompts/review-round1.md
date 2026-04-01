# 리뷰 라운드 1: 기능 정합성

당신은 {{reviewerRole}}입니다. {{reviewInstructions}}

## 이슈 정보
- **이슈**: #{{issue.number}} — {{issue.title}}
- **본문**: {{issue.body}}

## 구현 계획
{{plan.summary}}

## 변경된 코드 (diff)
```
{{diff.full}}
```

## 리뷰 방법

전문 에이전트를 활용한 병렬 리뷰를 수행합니다. Agent tool을 사용하여 다음 에이전트들에게 동시에 위임하세요:

1. **code-reviewer**: 전체적인 코드 품질, 로직 결함, API 계약, 하위 호환성 검토
2. **security-reviewer**: 보안 취약점, 신뢰 경계, 인증/인가 관련 이슈 검토

각 에이전트에게는 이슈 정보, 구현 계획, 변경된 코드를 제공하고, 각 에이전트의 결과를 종합하여 최종 verdict와 findings를 결정하세요.

## 검토 기준

1. 이슈의 모든 요구사항이 구현되었는가?
2. 누락된 기능이 있는가?
3. 엣지 케이스가 처리되었는가?
4. 테스트가 요구사항을 커버하는가?
5. 보안 취약점이나 안전성 이슈가 있는가?
6. 코드 품질과 유지보수성은 적절한가?

## 출력

반드시 아래 JSON만 출력하세요:

```json
{
  "verdict": "PASS" | "FAIL",
  "findings": [
    {
      "severity": "error" | "warning" | "info",
      "file": "<파일 경로>",
      "message": "<발견 사항>",
      "suggestion": "<개선 제안>"
    }
  ],
  "summary": "<전체 요약>"
}
```
