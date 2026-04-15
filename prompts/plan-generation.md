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
