## 변경 사항

<!-- 이 PR에서 무엇을 변경했는지 간략히 설명하세요 -->

## 체크리스트

- [ ] 코드 빌드 확인 (`npx tsc --noEmit`)
- [ ] 테스트 통과 확인 (`npx vitest run`)
- [ ] 린트 통과 확인 (`npx eslint src/ tests/`)

### UI 변경 포함 시

- [ ] UI 변경이 없거나 visual baseline 재생성이 불필요함
- [ ] UI 변경 포함 — visual baseline 재생성 완료 (`gh workflow run regen-visual-baseline.yml`)
