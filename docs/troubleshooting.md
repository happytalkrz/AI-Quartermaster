# AI 병참부 트러블슈팅 가이드

AI 병참부 사용 중 발생할 수 있는 일반적인 문제들과 해결 방법을 정리한 가이드입니다.

## 🔍 에러 분류 시스템

AI 병참부는 에러를 다음과 같이 분류하여 관리합니다:

| 에러 타입 | 설명 | 감지 키워드 |
|-----------|------|-------------|
| `TS_ERROR` | TypeScript 타입 에러 | `ts1`, `ts2`, `type error`, `cannot find name` |
| `TIMEOUT` | 시간 초과 | `timeout`, `timed out`, `sigterm` |
| `CLI_CRASH` | CLI 도구 크래시 | `enoent`, `spawn`, `cli_crash`, `exited with code` |
| `VERIFICATION_FAILED` | 검증 실패 | `tests failed`, `lint`, `verification` |
| `SAFETY_VIOLATION` | 안전장치 위반 | `safety`, `sensitive`, `violation` |
| `UNKNOWN` | 미분류 에러 | 위에 해당하지 않는 모든 에러 |

---

## 🚨 Prompt Too Long (프롬프트 길이 초과)

### 현상
```
Error: Prompt too long. Claude API has token limits.
Maximum context window exceeded.
```

### 원인
- 매우 큰 파일들이 프롬프트에 포함됨
- 많은 파일을 동시에 처리하려고 함
- 긴 로그나 코드 히스토리가 누적됨

### 해결책

#### 1. 파일 크기 제한
```yaml
# config.yml
claude:
  maxFileSize: 50000  # 50KB로 제한
  excludePatterns:
    - "**/*.min.js"
    - "**/node_modules/**"
    - "**/dist/**"
    - "**/*.log"
```

#### 2. Phase 분할 최적화
큰 작업을 더 작은 단위로 분할:
```yaml
# 이슈에 Phase 분할 힌트 추가
---
phases_hint: |
  1. core logic 수정
  2. tests 추가  
  3. documentation 업데이트
```

#### 3. 선택적 컨텍스트 로딩
```bash
# 특정 디렉토리만 포함
aqm run --context-dirs="src/core,tests/unit"
```

#### 4. 로그 정리
```bash
# 긴 실행 로그 정리
rm -rf .aq-logs/old-*
aqm config set claude.maxLogLines 100
```

---

## ⏱️ Rate Limit (API 요청 제한)

### 현상
```
Error: Rate limit exceeded. Please try again later.
Claude API: 429 Too Many Requests
```

### 원인
- Claude API 호출 빈도 제한 초과
- 동시 실행 작업이 너무 많음
- 재시도 로직이 과도하게 실행됨

### 해결책

#### 1. 동시성 제한
```yaml
# config.yml
general:
  concurrency: 1  # 동시 작업 수 제한
queue:
  retryDelay: 60000  # 재시도 간격 증가 (60초)
```

#### 2. 백오프 전략 설정
```yaml
claude:
  maxRetries: 2
  retryBackoff: "exponential"  # 지수 백오프
  initialDelay: 5000  # 5초 시작
```

#### 3. 작업 스케줄링
```bash
# 작업 간 간격 두기
aqm queue add owner/repo 123 --delay=300  # 5분 지연
```

#### 4. API 키 로테이션 (권장)
```yaml
claude:
  apiKeys:
    - key1
    - key2
    - key3
  rotationStrategy: "round_robin"
```

---

## 🧹 Worktree 정리 문제

### 현상
```
Error: worktree already exists
fatal: 'path/to/worktree' already exists and is not empty
disk space running low due to accumulated worktrees
```

### 원인
- 실패한 작업의 worktree가 정리되지 않음
- 수동으로 중단된 작업의 잔여 파일
- 디스크 공간 부족

### 해결책

#### 1. 자동 정리 설정 확인
```yaml
# config.yml
cleanup:
  cleanupOnSuccess: true
  cleanupOnFailure: true
  maxWorktreeAge: 86400  # 24시간 후 자동 삭제
```

#### 2. 수동 정리
```bash
# 모든 AQ worktree 정리
aqm cleanup --all

# 특정 이슈의 worktree만 정리
aqm cleanup --issue=123

# 강제 정리 (주의!)
aqm cleanup --force --all
```

#### 3. 디스크 공간 확인
```bash
# worktree 디렉토리 크기 확인
du -sh .aq-worktrees/

# 오래된 worktree 찾기
find .aq-worktrees/ -type d -mtime +7 -name "*-*"
```

#### 4. 정리 스크립트 설정
```bash
# crontab 추가 (매일 새벽 2시)
0 2 * * * cd /path/to/project && aqm cleanup --older-than=7d
```

---

## ⚙️ Config 에러

### 현상
```
Error: Configuration validation failed
Invalid config field: general.concurrency must be a positive integer
Cannot find project configuration for repo 'owner/repo'
```

### 원인
- 잘못된 설정 값
- 필수 설정 누락
- 설정 파일 구문 오류

### 해결책

#### 1. 설정 검증
```bash
# 현재 설정 검증
aqm config validate

# 설정 스키마 확인
aqm config schema
```

#### 2. 기본값으로 리셋
```bash
# 전체 설정 리셋
aqm config reset

# 특정 섹션만 리셋
aqm config reset --section=general
```

#### 3. 설정 파일 수정
```yaml
# config.yml - 올바른 형식
general:
  concurrency: 3        # 양의 정수
  logLevel: "info"      # 문자열 인용
  timeout: 300000       # 밀리초 단위

projects:
  - repo: "owner/repo"  # 필수
    path: "/full/path"  # 절대 경로 필수
    baseBranch: "main"  # 선택사항
    mode: "code"        # code 또는 content
```

#### 4. 프로젝트별 설정
```bash
# 새 프로젝트 추가
aqm config add-project owner/repo /path/to/repo

# 프로젝트 설정 수정
aqm config update-project owner/repo --base-branch=develop
```

---

## 📝 TypeScript/타입 에러

### 현상
```
TS2304: Cannot find name 'SomeType'
TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
Tests failed: Type check failed
```

### 원인
- 타입 정의 파일 누락
- import 경로 오류
- 의존성 버전 불일치

### 해결책

#### 1. 타입 체크 설정
```yaml
# config.yml
verification:
  typeCheck: true
  strictMode: false    # 엄격 모드 비활성화
  skipLibCheck: true   # 라이브러리 타입 체크 건너뛰기
```

#### 2. 의존성 업데이트
```bash
# 프로젝트 의존성 동기화
cd /path/to/project
npm ci  # 또는 yarn install --frozen-lockfile
```

#### 3. 타입 파일 확인
```bash
# 누락된 타입 정의 확인
npx tsc --noEmit --listFiles | grep -E "\.(d\.)?ts$"

# 타입 패키지 설치
npm install --save-dev @types/node @types/jest
```

#### 4. Claude에 타입 컨텍스트 제공
이슈에 타입 정보 추가:
```markdown
## 타입 정의 참조
- `src/types/index.ts` - 메인 타입 정의
- `src/interfaces/api.ts` - API 인터페이스
```

---

## ⏰ Timeout (시간 초과)

### 현상
```
Error: Timeout in phase_execution after 300000ms
Claude CLI timed out after 180 seconds
Job killed due to timeout
```

### 원인
- 대용량 프로젝트 처리
- 네트워크 지연
- Claude API 응답 지연

### 해결책

#### 1. 타임아웃 시간 증가
```yaml
# config.yml
general:
  timeout: 600000      # 10분으로 증가

claude:
  timeout: 300000      # Claude CLI 타임아웃 5분

pipeline:
  phaseTimeout: 900000 # Phase별 타임아웃 15분
```

#### 2. 작업 크기 축소
- 더 작은 Phase로 분할
- 한 번에 수정하는 파일 수 제한
- 복잡한 작업을 여러 이슈로 분리

#### 3. 프로그레스 모니터링
```bash
# 실시간 로그 확인
aqm logs --follow --job=job-id

# 작업 상태 확인
aqm status
```

---

## 💥 CLI 크래시

### 현상
```
Error: spawn claude ENOENT
Command 'claude' not found
Claude CLI exited with code 1
```

### 원인
- Claude CLI가 설치되지 않음
- PATH 환경변수 문제
- 권한 문제

### 해결책

#### 1. Claude CLI 설치 확인
```bash
# Claude CLI 설치 확인
which claude
claude --version

# 설치되지 않은 경우
npm install -g @anthropic-ai/claude-cli
```

#### 2. PATH 설정
```bash
# PATH에 claude 추가
echo 'export PATH=$PATH:/usr/local/bin' >> ~/.bashrc
source ~/.bashrc
```

#### 3. 권한 문제 해결
```bash
# 실행 권한 부여
chmod +x $(which claude)

# sudo 없이 실행되도록 설정
sudo chown $USER:$USER $(which claude)
```

#### 4. 대체 실행 경로 설정
```yaml
# config.yml
commands:
  claudeCli:
    path: "/full/path/to/claude"  # 절대 경로 지정
    timeout: 180000
```

---

## 🛡️ Safety Violation (안전장치 위반)

### 현상
```
SafetyViolationError: [PATH_RESTRICTION] Cannot modify files outside project directory
SafetyViolationError: [SENSITIVE_FILE] Detected sensitive file: .env
SafetyViolationError: [CHANGE_LIMIT] Too many files modified (50 > 20)
```

### 원인
- 프로젝트 디렉토리 외부 파일 수정 시도
- 민감한 파일(.env, 비밀키 등) 수정 시도
- 너무 많은 파일을 한 번에 수정

### 해결책

#### 1. 안전장치 설정 조정
```yaml
# config.yml
safety:
  pathRestriction: true
  maxFilesPerPhase: 50      # 제한 완화
  sensitiveFilePatterns:    # 패턴 수정
    - "**/.env*"
    - "**/secrets/**"
    # - "**/*.key"  # 주석 처리로 제외
```

#### 2. 작업 범위 명시
이슈에 명확한 작업 범위 지정:
```markdown
## 작업 범위
- 수정 대상: `src/` 디렉토리만
- 제외: 설정 파일, 환경 변수
```

#### 3. Phase별 분할
```markdown
## 구현 계획
1. Phase 1: 핵심 로직 수정 (src/core/ 5개 파일)
2. Phase 2: 테스트 추가 (tests/ 3개 파일)
3. Phase 3: 문서 업데이트 (docs/ 2개 파일)
```

---

## ⚡ MaxTurns 초과 (Claude 대화 턴 제한)

### 현상
```
Error: Claude max turns exceeded — increase commands.claudeCli.maxTurns in config
Job failed: 최대 턴 수를 초과했습니다
Phase execution failed: maxTurns limit reached
```

### 원인
- Claude CLI 대화가 설정된 최대 턴 수를 초과함
- 복잡한 작업이나 긴 디버깅 과정으로 인한 초과
- 실행 모드별 maxTurns 제한에 걸림

### 해결책

#### 1. maxTurns 설정 조정
```yaml
# config.yml - 전역 또는 모드별 설정
commands:
  claudeCli:
    maxTurns: 100  # 전역 제한 증가 (기본값 60)
    maxTurnsPerMode:  # 또는 모드별 제한
      code: 80        # 코드 작업용
      content: 40     # 콘텐츠 작업용
      debug: 120      # 디버깅용
```

#### 2. 작업 분할
큰 작업을 더 작은 Phase로 분할:
```markdown
# 이슈에 Phase 분할 힌트 추가
---
phases_hint: |
  1. 기본 구조 구현 (5개 파일)
  2. 테스트 추가 (3개 파일)  
  3. 문서 업데이트 (2개 파일)
  4. 리팩터링 및 최적화
```

#### 3. 실행 모드 조정
```bash
# 작업 복잡도에 맞게 모드 선택
aqm run --mode=content  # 간단한 작업
aqm run --mode=debug    # 복잡한 디버깅
```

---

## 📋 Plan 실패 (계획 생성 실패)

### 현상
```
Error: Plan generation failed after 3 attempts: Claude response timeout
Error: Plan generation failed: JSON 파싱 실패 (3회 시도)
Error: Plan generation failed: unexpected exit
Plan generation Claude call failed, collecting context for retry...
```

### 원인
- 이슈 내용이 불명확하거나 너무 복잡함
- Claude API 응답 지연 또는 타임아웃
- 계획 JSON 형식 파싱 실패
- 프로젝트 컨텍스트 부족

### 해결책

#### 1. 이슈 작성 개선
이슈에 다음 정보를 추가하세요:
```markdown
## 문제 정의
- 현재 상태: (구체적으로 기술)
- 목표 상태: (명확한 결과물)
- 제약사항: (제한사항이 있다면)

## 작업 범위  
- 수정할 파일들: src/components/*.tsx
- 제외할 영역: 외부 API 연동
```

#### 2. 계획 생성 재시도 설정
```yaml
# config.yml
pipeline:
  planning:
    maxRetries: 5      # 재시도 횟수 증가
    timeout: 300000    # 타임아웃 5분으로 증가
    enableContextCollection: true  # 컨텍스트 수집 활성화
```

#### 3. 프로젝트 정보 제공
자동 계획이 실패할 경우 수동으로 아래 정보를 이슈에 추가:
```markdown
## 프로젝트 컨텍스트
- 기술 스택: React, TypeScript, Vite
- 주요 디렉토리: src/components, src/utils
- 코딩 스타일: ESLint + Prettier
- 테스트: Vitest

## 구현 계획 (선택사항)
### Phase 1: 핵심 기능 수정
- 파일: src/components/UserList.tsx
- 작업: 검색 필터 기능 추가

### Phase 2: 테스트 추가
- 파일: tests/components/UserList.test.tsx
- 작업: 검색 필터 테스트 케이스
```

#### 4. 로그 분석 및 디버깅
```bash
# 계획 생성 실패 로그 확인
aqm logs --phase=planning --verbose

# Claude 응답 내용 확인
aqm logs --job=job-id | grep -A 10 "Plan generation"
```

---

## 🔧 일반적인 진단 방법

### 1. 로그 분석
```bash
# 최신 에러 로그 확인
aqm logs --level=error --recent

# 특정 작업의 상세 로그
aqm logs --job=job-id --verbose
```

### 2. 시스템 상태 확인
```bash
# 시스템 상태 체크
aqm doctor

# 의존성 확인
aqm doctor --check-deps

# 설정 검증
aqm doctor --check-config
```

### 3. 디버그 모드 실행
```bash
# 디버그 로그 활성화
aqm config set general.logLevel debug

# 단계별 실행
aqm run --debug --dry-run
```

### 4. 환경 정보 수집
```bash
# 버그 리포트용 환경 정보
aqm env-info > debug-info.txt
```

---

## 📞 추가 지원

### 로그 제출
문제가 해결되지 않으면 다음 정보와 함께 이슈를 보고하세요:

```bash
# 환경 정보 수집
aqm env-info > environment.txt

# 에러 로그 수집
aqm logs --job=failed-job-id > error.log

# 설정 정보 (민감한 정보 제외)
aqm config show --sanitized > config.txt
```

### 자주 묻는 질문
- **Q: 작업이 멈춰있어요** → `aqm status`로 상태 확인, 필요시 `aqm queue restart`
- **Q: 디스크 공간이 부족해요** → `aqm cleanup --all`로 정리
- **Q: 설정이 적용되지 않아요** → `aqm restart`로 서비스 재시작

### 추가 리소스
- [설정 스키마 문서](config-schema.md)
- [아키텍처 문서](architecture.md)
- [개발 가이드](../README.md)