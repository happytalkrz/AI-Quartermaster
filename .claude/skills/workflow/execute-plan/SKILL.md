---
name: execute-plan
description: This skill should be used when the user asks to "execute plan", "플랜 실행", "이슈 올려", "플랜 집행", "이슈 쪼개서 올려", or mentions workplan execution, issue batching, dependency-based issue creation.
---

# 워크플랜 집행 — 이슈 발행 규칙

## 핵심 원칙

워크플랜의 이슈를 GitHub에 발행할 때 반드시 아래 규칙을 따른다.

### 1. 의존성 기반 배치 분류

이슈를 **배치(batch)**로 나눈다:
- **같은 배치**: 서로 의존성이 없는 이슈들 → 한번에 모두 발행
- **다른 배치**: 이전 배치의 이슈가 develop에 머지된 후에만 발행

```
배치 1: [이슈 A, 이슈 B, 이슈 C]  ← 동시 발행, 병렬 처리
  ↓ (전부 develop 머지 확인 후)
배치 2: [이슈 D, 이슈 E]          ← 동시 발행
  ↓ (전부 develop 머지 확인 후)
배치 3: [이슈 F]                   ← 발행
```

### 2. 이슈 발행 형식

`create-issue` 스킬의 형식을 따른다:

```markdown
## 요구사항

- [ ] 구체적 요구사항 1
- [ ] 구체적 요구사항 2

## 관련 파일

- `src/path/to/file.ts` — 설명

## 참고

- 기존 동작을 깨뜨리지 않을 것
- `npx tsc --noEmit` + `npx vitest run` 통과 필수
```

의존성이 있으면 본문에 `depends: #N` 포함.

### 3. 발행 후 대기

배치 발행 후:
1. AQM이 처리할 때까지 대기
2. 모든 이슈의 PR이 develop에 머지 확인
3. 다음 배치 발행

### 4. 발행 명령

```bash
gh issue create --repo happytalkrz/AI-Quartermaster \
  --title "이슈 제목" \
  --body "이슈 본문" \
  --label "ai-quartermaster"
```

## 실행 절차

1. 워크플랜 파일 읽기 (`.claude/workplan/{name}.md`)
2. 이슈 간 의존성 분석 → 배치 분류
3. 배치별 이슈 목록을 사용자에게 제시
4. 승인 후 현재 배치의 이슈들을 한번에 발행
5. AQM 처리 + develop 머지 대기
6. 다음 배치 반복

## 주의사항

- 의존성이 있는 이슈를 선행 이슈 머지 전에 발행하지 않는다
- 한 배치 내 이슈들은 서로 같은 파일을 수정하지 않아야 한다 (git 충돌 방지)
- 배치 실행 중 실패한 이슈가 있으면 해당 배치를 해결한 후 다음 배치로 진행

## Gotchas
- [2026-04-04] concurrency 높이면 같은 테스트 파일을 여러 이슈가 동시 수정해서 충돌 빈발 — 배치 내 이슈들이 공유 테스트 파일(특히 `tests/pipeline/core-loop.test.ts`, `tests/github/pr-creator.test.ts`) 건드리면 concurrency=1로 낮출 것
- [2026-04-04] 리뷰 단계에서 "Prompt is too long" 에러 발생 — 프로젝트 커지면서 diff가 모델 컨텍스트 한도 초과. 이슈 크기를 줄이거나 수정 파일 수를 제한
- [2026-04-04] Phase 실패인데 job이 success로 마킹되는 버그 존재 (#153) — 파이프라인 완료 후 job 상태와 실제 코드 변경사항을 교차 검증할 것
