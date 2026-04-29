# Plan 생성

GitHub 이슈를 분석하여 구현 계획을 JSON으로 출력하세요.

## 이슈

- **#{{issue.number}}**: {{issue.title}}
- **라벨**: {{issue.labels}}

{{issue.body}}

## 프로젝트

- **저장소**: {{repo.owner}}/{{repo.name}}
- **베이스**: {{branch.base}} → **작업**: {{branch.work}}

### 디렉토리 구조

```
{{repo.structure}}
```

{{designFilesSection}}
## 제약

- Phase 최대 {{config.maxPhases}}개. content 모드(문서/설정)는 1개.
- 민감 파일 수정 금지: {{config.sensitivePaths}}
- `dependsOn`으로 Phase 간 의존성 명시 (병렬 실행 최적화).
- 이슈 본문의 관련 파일/힌트를 우선 활용. 파일 탐색은 최소한으로.

### JSON 출력 문자열 제약 (필수)

- 모든 문자열 값은 단일 라인으로 작성. 줄바꿈이 필요하면 반드시 `\n`으로 escape — 실제 개행 문자 삽입 금지.
- 문자열 값에 백틱(`) 사용 금지. 코드·명령 표기는 일반 따옴표(")를 사용할 것.
- `problemDefinition`은 200자 이내 한글 요약으로 작성. 상세 배경·설명은 `phases[].description` 등 별도 필드로 분리.
