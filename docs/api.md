# AI 병참부 대시보드 API 문서

AI 병참부 대시보드는 REST API를 통해 작업 모니터링, 설정 관리, 통계 조회 기능을 제공합니다.

## 인증 (Authentication)

대시보드 API는 Bearer 토큰 기반 인증을 사용합니다.

### 설정

`config.yml`에서 API 키를 설정:

```yaml
server:
  apiKey: "your-secure-api-key-here"
```

### 인증 방법

#### 1. Bearer 토큰 (일반 API 엔드포인트)

모든 `/api/*` 엔드포인트에서 사용:

```bash
curl -H "Authorization: Bearer your-api-key" http://localhost:3000/api/jobs
```

#### 2. 세션 토큰 (SSE 엔드포인트)

SSE(Server-Sent Events) 엔드포인트는 브라우저 EventSource API 제약으로 인해 헤더를 설정할 수 없어 쿼리 파라미터 토큰을 사용합니다.

**세션 토큰 발급:**
```bash
curl -X POST -H "Authorization: Bearer your-api-key" http://localhost:3000/api/auth
```

**응답:**
```json
{
  "token": "uuid-session-token",
  "expiresIn": 3600000
}
```

**SSE 사용:**
```javascript
const eventSource = new EventSource('/api/events?token=uuid-session-token');
```

---

## Jobs API

### GET /api/jobs
작업 목록을 조회합니다.

**쿼리 파라미터:**
- `include=archived` - 보관된 작업 포함 (기본값: 제외)

**응답:**
```json
{
  "jobs": [
    {
      "id": "job-uuid",
      "issueNumber": 123,
      "repo": "owner/repo",
      "status": "running",
      "createdAt": "2026-04-04T10:00:00Z",
      "startedAt": "2026-04-04T10:00:05Z",
      "logs": ["Starting job...", "Cloning repository..."],
      "plan": {
        "title": "Fix user authentication bug",
        "phases": [...]
      }
    }
  ],
  "queue": {
    "active": 1,
    "waiting": 2,
    "concurrency": 3
  }
}
```

### GET /api/jobs/:id
특정 작업의 상세 정보를 조회합니다.

**응답:**
```json
{
  "id": "job-uuid",
  "issueNumber": 123,
  "repo": "owner/repo",
  "status": "running",
  "createdAt": "2026-04-04T10:00:00Z",
  "startedAt": "2026-04-04T10:00:05Z",
  "completedAt": null,
  "logs": ["Starting job...", "Cloning repository..."],
  "plan": {
    "issueNumber": 123,
    "title": "Fix user authentication bug",
    "problemDefinition": "Users cannot log in due to token validation error",
    "requirements": ["Fix token validation", "Add error handling"],
    "phases": [
      {
        "index": 1,
        "name": "Fix token validation logic",
        "description": "Update auth middleware to properly validate JWT tokens",
        "targetFiles": ["src/auth/middleware.ts"],
        "verificationCriteria": ["Tests pass", "Lint clean"]
      }
    ]
  },
  "error": null
}
```

### POST /api/jobs/:id/cancel
실행 중인 작업을 취소합니다.

**응답:**
```json
{
  "status": "cancelled",
  "id": "job-uuid"
}
```

**에러:**
- `404` - 작업을 찾을 수 없거나 취소할 수 없음

### POST /api/jobs/:id/retry
실패하거나 취소된 작업을 재시도합니다.

**응답:**
```json
{
  "status": "queued",
  "id": "new-job-uuid"
}
```

**에러:**
- `404` - 작업을 찾을 수 없음
- `400` - 실패/취소되지 않은 작업은 재시도 불가

### DELETE /api/jobs/:id
완료된 작업을 삭제합니다.

**응답:**
```json
{
  "status": "deleted",
  "id": "job-uuid"
}
```

**에러:**
- `400` - 실행 중인 작업은 삭제 불가 (먼저 취소 필요)

---

## Configuration API

### GET /api/config
현재 설정을 조회합니다. (민감한 정보는 마스킹됨)

**응답:**
```json
{
  "config": {
    "general": {
      "concurrency": 3,
      "logLevel": "info",
      "timeout": 300000
    },
    "git": {
      "user": {
        "name": "AI-Quartermaster",
        "email": "***@***"
      }
    },
    "claude": {
      "timeout": 180000,
      "maxRetries": 3
    },
    "projects": [
      {
        "repo": "owner/repo",
        "path": "/path/to/repo",
        "baseBranch": "main",
        "mode": "code"
      }
    ]
  }
}
```

### PUT /api/config
설정을 업데이트합니다.

**요청 본문:**
```json
{
  "general": {
    "concurrency": 5,
    "logLevel": "debug"
  }
}
```

**응답:**
```json
{
  "success": true,
  "message": "Configuration updated successfully"
}
```

**에러:**
- `400` - 설정 검증 실패
- `500` - 설정 파일 업데이트 실패

---

## Projects API

### POST /api/projects
새 프로젝트를 추가합니다.

**요청 본문:**
```json
{
  "repo": "owner/new-repo",
  "path": "/path/to/new-repo",
  "baseBranch": "develop",
  "mode": "content"
}
```

**응답:**
```json
{
  "message": "Project added successfully",
  "project": {
    "repo": "owner/new-repo",
    "path": "/path/to/new-repo",
    "baseBranch": "develop",
    "mode": "content"
  }
}
```

**에러:**
- `400` - 필수 필드 누락 또는 유효하지 않은 값
- `409` - 이미 존재하는 프로젝트

### PUT /api/projects/:repo
기존 프로젝트를 수정합니다.

**요청 본문:**
```json
{
  "path": "/new/path/to/repo",
  "baseBranch": "main",
  "mode": "code"
}
```

**응답:**
```json
{
  "message": "Project updated successfully",
  "repo": "owner/repo",
  "updates": {
    "path": "/new/path/to/repo",
    "baseBranch": "main",
    "mode": "code"
  }
}
```

### DELETE /api/projects/:repo
프로젝트를 제거합니다.

**응답:**
```json
{
  "message": "Project removed successfully",
  "repo": "owner/repo"
}
```

**에러:**
- `404` - 프로젝트를 찾을 수 없음

---

## Stats API

### GET /api/stats
대시보드 통계를 조회합니다.

**응답:**
```json
{
  "total": 42,
  "successCount": 35,
  "failureCount": 5,
  "runningCount": 1,
  "queuedCount": 1,
  "cancelledCount": 0,
  "avgDurationMs": 120000,
  "successRate": 83
}
```

---

## Server-Sent Events (SSE)

### GET /api/events
실시간 대시보드 업데이트를 스트리밍합니다.

**인증:** 쿼리 파라미터 `?token=session-token` 사용

**이벤트 타입:**
- `data` - 초기 상태 및 주기적 업데이트
- `jobCreated` - 새 작업 생성
- `jobUpdated` - 작업 상태 변경
- `jobDeleted` - 작업 삭제
- `configChanged` - 설정 변경

**예시:**
```javascript
const eventSource = new EventSource('/api/events?token=your-session-token');

eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log('Dashboard update:', data);
};

eventSource.addEventListener('jobUpdated', function(event) {
  const { id, job } = JSON.parse(event.data);
  console.log(`Job ${id} updated:`, job);
});
```

### GET /api/jobs/:id/logs/stream
특정 작업의 로그를 실시간으로 스트리밍합니다.

**인증:** 쿼리 파라미터 `?token=session-token` 사용

**이벤트 타입:**
- `data` - 로그 라인
- `error` - 에러 발생
- `done` - 작업 완료

**예시:**
```javascript
const logStream = new EventSource(`/api/jobs/${jobId}/logs/stream?token=your-session-token`);

logStream.onmessage = function(event) {
  const { line, status } = JSON.parse(event.data);
  console.log(`[${status}] ${line}`);
};

logStream.addEventListener('done', function(event) {
  const { status } = JSON.parse(event.data);
  console.log(`Job completed with status: ${status}`);
  logStream.close();
});
```

---

## 에러 응답

모든 API 엔드포인트는 일관된 에러 형식을 사용합니다:

```json
{
  "error": "Error description"
}
```

**HTTP 상태 코드:**
- `400` - 잘못된 요청 (유효성 검사 실패)
- `401` - 인증 필요
- `404` - 리소스를 찾을 수 없음
- `409` - 충돌 (중복 리소스)
- `500` - 서버 내부 오류

---

## 개발 및 디버깅

### 로컬 개발

```bash
# 서버 시작
npm run dev

# API 테스트
curl -H "Authorization: Bearer test-key" http://localhost:3000/api/stats
```

### 로그 수준 설정

```yaml
# config.yml
general:
  logLevel: debug  # trace, debug, info, warn, error
```

### SSE 연결 테스트

```bash
# 세션 토큰 발급
TOKEN=$(curl -s -X POST -H "Authorization: Bearer your-key" http://localhost:3000/api/auth | jq -r .token)

# SSE 스트림 구독
curl -N "http://localhost:3000/api/events?token=$TOKEN"
```