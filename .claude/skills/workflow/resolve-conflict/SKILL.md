---
name: resolve-conflict
description: This skill should be used when the user mentions "컨플릭", "conflict", "충돌 해소", "머지 충돌", "컨플릭 해소", or asks to resolve merge conflicts on a PR branch.
---

# PR 머지 충돌 해소

## 절차

1. **PR 브랜치 체크아웃**
   ```bash
   git fetch origin <pr-branch>
   git checkout <pr-branch>
   ```

2. **develop 최신화 후 머지 시도**
   ```bash
   git fetch origin develop
   git merge origin/develop
   ```

3. **충돌 파일 확인**
   ```bash
   grep -rn "<<<<<<" <conflicted-files>
   ```

4. **충돌 해소**
   - 각 충돌 파일을 Read로 읽어서 양쪽 변경사항 파악
   - 양쪽 코드가 모두 필요하면 둘 다 유지
   - 한쪽이 다른 쪽의 상위 버전이면 최신 버전 유지
   - 충돌 마커(`<<<<<<<`, `=======`, `>>>>>>>`) 완전 제거

5. **검증** (병렬 실행)
   - `grep -rn "<<<<<<" <files>` — 잔여 충돌 마커 없는지 확인
   - `npx tsc --noEmit` — 타입 체크 통과
   - `npx vitest run <related-test-files>` — 관련 테스트 통과

6. **커밋 + 푸시**
   ```bash
   git add <resolved-files>
   git commit -m "fix: PR #<number> develop 머지 충돌 해결 (<파일 목록>)"
   git push origin <pr-branch>
   ```

7. **원래 브랜치로 복귀**
   ```bash
   git checkout develop
   ```

8. **결과 보고**: PR 번호, 해소된 파일, 테스트 통과 여부 알림

## 주의사항

- 충돌 해소 시 양쪽 기능을 모두 보존하는 것이 기본 원칙
- 판단이 어려운 경우 사용자에게 어떤 쪽을 우선할지 확인
- 커밋 메시지에 Co-Authored-By 넣지 않음 (프로젝트 규칙)

## Gotchas
- [2026-04-04] `tests/github/pr-creator.test.ts`와 `tests/pipeline/core-loop.test.ts`는 거의 매번 충돌 발생 — 여러 이슈가 같은 테스트 파일을 동시에 수정하는 구조적 원인. 항상 이 두 파일을 우선 확인
- [2026-04-04] 충돌 해소 후 `npx vitest run` 없이 push하면 CI에서 깨짐 — 반드시 로컬 테스트 통과 확인 후 push
