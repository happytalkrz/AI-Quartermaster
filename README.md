# AI Quartermaster

GitHub Issue에 라벨을 붙이면 Claude가 자동으로 구현하고 Draft PR을 만들어줍니다.

## 설치

```bash
curl -fsSL https://raw.githubusercontent.com/happytalkrz/AI-Quartermaster/main/install.sh | bash
```

> Node.js 20+, Git, [GitHub CLI](https://cli.github.com), [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) 필요

## 시작

```bash
aqm setup                                    # 초기 설정
# config.yml → projects 섹션에 대상 프로젝트 추가
aqm start --daemon                           # 서버 시작
```

이후 GitHub 이슈에 `ai-quartermaster` 라벨만 붙이면 자동 실행됩니다.

## 명령어

```bash
aqm setup                                    # 초기 설정
aqm start [--daemon]                         # 서버 시작
aqm stop                                     # 서버 중지
aqm run --issue <n> --repo <owner/repo>      # 수동 실행
aqm status                                   # 큐 상태
aqm logs                                     # 서버 로그
aqm update                                   # 업데이트
```

## 설정 (config.yml)

```yaml
projects:
  - repo: "myorg/my-repo"
    path: "/path/to/local/clone"
    baseBranch: "main"
```

여러 프로젝트 등록 가능. 프로젝트별 명령어(test, lint, build) 오버라이드 지원.

## 대시보드

http://localhost:3000 — 실시간 작업 상태, PR 링크, 에러 확인, 다크/라이트 테마.

## 라이선스

MIT
