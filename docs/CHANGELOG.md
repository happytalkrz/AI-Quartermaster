# AI Quartermaster - Changelog

## 현재 상태 (2026-03-22)

- 소스 48개 / 테스트 21개 (104 tests) / typecheck clean
- GitHub: https://github.com/happytalkrz/AI-Quartermaster

## 커밋 히스토리

```
f5f4a0e refactor: 전체 코드 Simplify (Tier 1/2/3 — 24개 항목)
987a9c8 fix: 브랜치 삭제 시 연결된 worktree 먼저 제거
57d7d3c feat: install.sh 래퍼 분리 + running 스피너 애니메이션
29ada40 fix: 브랜치/worktree 충돌 시 자동 정리 + update 시 pager 제거
a549a98 fix: worktree 경로 충돌 시 자동 정리 후 재생성
22937ad feat: start 시 프로젝트 검증 + webhook 자동 등록
4d9f12c docs: README 퀵가이드로 간결하게 재작성
fc49a16 feat: 범용 프로젝트로 전환 (setup 명령어 + 개인 설정 분리)
43ec4cb feat: 멀티 프로젝트 지원 + 대시보드 UI 개선
6fe1451 fix: 3라운드 코드 리뷰 반영 (CRITICAL/HIGH/MEDIUM)
ac972e2 fix: safety-checker를 오케스트레이터에 통합
d79562f feat: Phase 5 - 자동화 (웹훅/큐/대시보드/알림/CLI)
630571e feat: Phase 4 - 안전장치
b403ab7 feat: Phase 3 - 품질 계층
a8bad7e feat: Phase 2 - 기본 파이프라인
1ca1ce7 feat: Phase 1 - 설계 문서 + PoC 핵심 루프 구현
```

## 완료된 기능

### 핵심 파이프라인
- [x] GitHub Issue fetch (gh CLI)
- [x] Claude CLI로 Plan 생성 (phase 분할)
- [x] Phase별 구현 + 자동 커밋
- [x] 3라운드 AI 리뷰 (기능 정합성 / 구조 설계 / 단순화)
- [x] 코드 간소화 (테스트 실패 시 롤백)
- [x] 최종 검증 (test + lint + build + typecheck, test/typecheck 병렬)
- [x] Draft PR 자동 생성
- [x] GitHub 이슈에 결과 알림 코멘트

### Git 관리
- [x] 자동 브랜치 생성 (aq/{issueNumber}-{slug})
- [x] Git worktree 격리 (메인 디렉토리 오염 방지)
- [x] 브랜치/worktree 충돌 시 자동 정리 후 재생성
- [x] worktree 정리 (maxAge 기반)

### 안전장치
- [x] 베이스 브랜치 보호
- [x] 민감 파일 수정 차단 (minimatch glob)
- [x] 변경량 제한 (파일 수, 추가/삭제 라인)
- [x] Phase 수 제한
- [x] 이슈 라벨 필터
- [x] 전체 파이프라인 타임아웃 (PipelineTimer)
- [x] Claude 프로세스 SIGKILL 폴백

### 서버/자동화
- [x] Webhook 서버 (Hono, HMAC-SHA256 검증)
- [x] smee.io 자동 연결 (start 시)
- [x] 작업 큐 (동시 실행 제한, 중복 방지, 취소)
- [x] 인메모리 캐시 + JSON 파일 영속화
- [x] 서버 재시작 시 미완료 작업 자동 복구
- [x] 데몬 모드 (start --daemon / stop / restart / logs)

### 대시보드
- [x] 실시간 SSE 업데이트
- [x] 카드 뷰 (5개 이하) / 사이드바+상세 패널 (5개 초과)
- [x] 필터 탭 (전체/진행중/성공/실패)
- [x] 작업 삭제 / 전체 삭제
- [x] 다크/라이트 테마 토글
- [x] Running 스피너 애니메이션
- [x] 파이프라인 진행 단계 시각화

### 설치/배포
- [x] 원라인 설치 (curl | bash)
- [x] aqm CLI 래퍼 (update, uninstall, version, daemon)
- [x] aqm update 시 래퍼 자동 갱신
- [x] 멀티 프로젝트 지원 (config.yml projects 배열)
- [x] setup 명령어 (config, .env, smee, webhook 자동)
- [x] start 시 프로젝트 검증 + webhook 자동 등록

### 코드 품질
- [x] 3라운드 코드 리뷰 반영 (CRITICAL/HIGH/MEDIUM)
- [x] Simplify 24개 항목 적용 (코드 재사용, 효율, 구조)
- [x] 104개 테스트 통과
- [x] TypeScript strict 타입체크

## 남은 개선 사항 (미래)

### 기능
- [ ] 실시간 파이프라인 로그 (Job에 단계별 로그 저장 → 대시보드에서 표시)
- [ ] 이슈 크기별 light mode (리뷰 건너뛰기, phase 1개로)
- [ ] 수동 재실행 버튼 (대시보드에서)
- [ ] PR 코멘트 피드백 → 자동 수정 루프

### 인프라
- [ ] npm 패키지로 배포 (npx aqm)
- [ ] Docker 이미지
- [ ] systemd/launchd 서비스 등록 지원

### 모니터링
- [ ] API 비용 추적 (Claude 호출당 cost_usd 집계)
- [ ] 성공/실패율 통계
- [ ] Slack/Discord 알림 연동
