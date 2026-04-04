---
name: test
description: This skill should be used when the user asks to "run tests", "테스트 실행", "vitest", "add test", "테스트 추가", or mentions test coverage, mock patterns, test failures, test debugging.
level: 2
---

# Vitest 테스트

## 실행

```bash
# 전체
npx vitest run

# 특정 파일
npx vitest run tests/pipeline/orchestrator.test.ts

# 패턴 매칭
npx vitest run -t "should retry"

# watch 모드
npx vitest tests/pipeline/
```

## 테스트 구조

```
tests/
  {module}/           # src/ 구조와 1:1 매핑
    {file}.test.ts    # 대상 파일과 동일한 이름
```

## 테스트 작성 규칙

### Mock 패턴
이 프로젝트의 모든 테스트는 외부 의존성(Claude CLI, gh CLI, git, fs)을 mock한다.
`vi.mock()`은 파일 최상단에 선언:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../utils/cli-runner.js", () => ({
  runCli: vi.fn(),
  runShell: vi.fn(),
}));
```

### 테스트 대상별 가이드

| 모듈 | Mock 대상 | 주의사항 |
|------|----------|---------|
| pipeline/* | claude-runner, cli-runner, git ops | phaseResult.success 분기 모두 테스트 |
| safety/* | cli-runner (git diff) | 경계값 테스트 (limit 정확히, limit+1) |
| queue/* | job-store | 동시성, stuck 타임아웃, 복구 시나리오 |
| server/* | - | Hono app.request()로 HTTP 테스트 |
| config/* | fs (readFileSync) | deep merge 순서, 프로젝트 오버라이드 |

### 새 기능 테스트 체크리스트
- [ ] 정상 경로 (happy path)
- [ ] 실패 경로 (에러, 예외)
- [ ] 경계 조건 (빈 입력, 최대값)
- [ ] mock이 올바른 인자로 호출되었는지 검증

## 실패 디버깅

```bash
# 상세 출력
npx vitest run --reporter=verbose

# 단일 테스트 격리 실행
npx vitest run tests/specific.test.ts
```

실패 시 순서:
1. 에러 메시지에서 assertion 위치 확인
2. mock 반환값이 테스트 기대와 일치하는지 확인
3. 소스 코드 변경이 mock 인터페이스를 깨뜨렸는지 확인

## Gotchas
- [2026-04-04] worktree 잔재 테스트 파일이 CI에서 같이 실행되어 혼란 발생 — `npx vitest run` 전 `git worktree list`로 잔재 worktree 없는지 확인. 잔재 worktree의 `tests/` 파일이 vitest glob에 잡힐 수 있음
