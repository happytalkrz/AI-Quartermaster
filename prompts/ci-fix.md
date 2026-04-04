# CI 실패 자동 수정

CI에서 실패가 감지되었습니다. 로그를 분석하고 문제를 수정하세요.

## PR 정보

- **PR**: #{{pr.number}} in {{pr.repo}}
- **CI 상태**: {{ci.overall}}
- **실패한 체크**: {{ci.failedChecksCount}}/{{ci.totalChecksCount}}
- **마지막 확인**: {{ci.lastCheckedAt}}

## 실패한 체크들

{{failedChecks}}

## 로그 분석

{{logs}}

---

## 수정 지침

1. **로그를 주의 깊게 분석**하여 실패 원인을 파악하세요.
2. **테스트 실패**: 테스트 코드나 구현 코드를 수정하세요.
3. **빌드 실패**: 타입 에러, import 에러, 설정 파일 문제를 확인하세요.
4. **린트 실패**: 코드 스타일이나 품질 규칙을 준수하도록 수정하세요.
5. **보안 검사 실패**: 취약점을 수정하거나 안전한 대안을 사용하세요.
6. **dependency 문제**: package.json, import 경로, 버전 호환성을 확인하세요.

## 주의사항

- **기존 기능을 유지**하면서 문제만 수정하세요.
- **테스트가 통과**하도록 수정하되, 테스트 자체를 임의로 삭제하지 마세요.
- **타입 안전성을 유지**하세요. `any` 타입 사용을 지양하세요.
- **import 경로에 .js 확장자**를 반드시 포함하세요 (ESM 프로젝트).

## 수정 후 작업

수정 완료 후 반드시 **git add + git commit**을 실행하세요.
커밋 메시지는 간결하고 명확하게 작성하세요.

예시: 
- `ci: fix TypeScript errors in user service`
- `test: fix failing unit tests in pipeline module`
- `lint: fix ESLint violations in CI checker`

## 진행 보고

작업 중에는 주기적으로 진행 상황을 보고하세요:
`[HEARTBEAT] CI fix: <현재 하고 있는 작업>`