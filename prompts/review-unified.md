# 통합 리뷰: 기능 정합성 + 구조/설계 + 단순화

당신은 {{reviewerRole}}입니다. {{reviewInstructions}}

아래 코드를 **3가지 관점**에서 종합 검토하여 토큰 효율적인 리뷰를 수행하세요.

## 이슈 정보
- **이슈**: #{{issue.number}} — {{issue.title}}
- **본문**: {{issue.body}}

## 구현 계획
{{plan.summary}}

## 프로젝트 개발 가이드
{{skillsContext}}

## 변경된 코드 (diff)
```
{{diff.full}}
```

## 리뷰 방법

전문 에이전트를 활용한 병렬 리뷰를 수행합니다. Agent tool을 사용하여 다음 에이전트들에게 동시에 위임하세요:

1. **code-reviewer**: 전체적인 코드 품질, 로직 결함, API 계약, 하위 호환성 검토
2. **security-reviewer**: 보안 취약점, 신뢰 경계, 인증/인가 관련 이슈 검토
3. **architect**: 구조적 설계와 아키텍처 적절성 검토
4. **code-simplifier**: 기능 유지하면서 코드 단순화 제안

각 에이전트에게는 이슈 정보, 구현 계획, 변경된 코드를 제공하고, 각 에이전트의 결과를 종합하여 최종 verdict와 findings를 결정하세요.

## 검토 기준

### 1. 기능 정합성 (Functional Compliance)
- 이슈의 모든 요구사항이 구현되었는가?
- 누락된 기능이 있는가?
- 엣지 케이스가 처리되었는가?
- 테스트가 요구사항을 커버하는가?
- 보안 취약점이나 안전성 이슈가 있는가?

### 2. 구조/설계 적절성 (Architecture & Design)
- 코드 구조가 적절한가? (관심사 분리, 모듈화)
- 네이밍이 명확하고 일관성 있는가?
- 에러 처리가 적절한가?
- 불필요한 복잡성이 없는가?
- 성능 문제가 있는가?
- 기존 코드 패턴과 일관성 있는가?
- **[필수 위반 체크]** src/ 내 `any` 타입 추가 → FAIL (severity: error)
- **[필수 위반 체크]** `catch {}` 또는 `catch (e: any)` → FAIL (severity: error)
- **[필수 위반 체크]** import에 `.js` 확장자 누락 → FAIL (severity: error)
- **[필수 위반 체크]** config 필드 추가인데 3곳 미동기화 → FAIL (severity: error)

### 3. 단순화 가능성 (Simplification Opportunities)
- 불필요한 복잡성이 있는가?
- 중복 코드가 있는가?
- 사용되지 않는 변수/import가 있는가?
- 지나치게 긴 함수가 있는가?
- 불필요한 주석이 있는가?
- 기능을 유지하면서 단순화할 수 있는가?

## 출력

반드시 아래 JSON만 출력하세요:

```json
{
  "functionalCompliance": {
    "verdict": "PASS" | "FAIL",
    "findings": [
      {
        "severity": "error" | "warning" | "info",
        "file": "<파일 경로>",
        "message": "<발견 사항>",
        "suggestion": "<개선 제안>"
      }
    ],
    "summary": "<기능 정합성 요약>"
  },
  "architectureDesign": {
    "verdict": "PASS" | "FAIL",
    "findings": [
      {
        "severity": "error" | "warning" | "info",
        "file": "<파일 경로>",
        "message": "<발견 사항>",
        "suggestion": "<개선 제안>"
      }
    ],
    "summary": "<구조/설계 요약>"
  },
  "simplification": {
    "verdict": "PASS" | "FAIL",
    "findings": [
      {
        "severity": "error" | "warning" | "info",
        "file": "<파일 경로>",
        "message": "<발견 사항>",
        "suggestion": "<개선 제안>"
      }
    ],
    "summary": "<단순화 요약>"
  },
  "overall": {
    "verdict": "PASS" | "FAIL",
    "criticalIssues": ["<중요 이슈 목록>"],
    "summary": "<전체 종합 요약>"
  }
}
```