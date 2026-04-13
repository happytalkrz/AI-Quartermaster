# Document 5: Claude 실행 프롬프트 템플릿

## 개요

이 문서는 AI 병참부가 Claude CLI를 호출할 때 사용하는 5개의 프롬프트 템플릿을 정의한다. 각 템플릿은 `prompts/` 디렉토리에 독립 파일로 저장되며, 파이프라인 실행 시 템플릿 변수를 치환하여 Claude CLI의 `--print` 또는 파이프 입력으로 전달한다.

## 템플릿 변수 레퍼런스

파이프라인 런타임에서 주입되는 변수 목록:

| 변수 | 타입 | 설명 | 예시 |
|------|------|------|------|
| `{{issue.number}}` | `number` | GitHub 이슈 번호 | `42` |
| `{{issue.title}}` | `string` | 이슈 제목 | `"로그인 페이지 비밀번호 재설정 기능 추가"` |
| `{{issue.body}}` | `string` | 이슈 본문 (마크다운) | (전체 본문) |
| `{{issue.labels}}` | `string[]` | 이슈 라벨 목록 | `["enhancement", "aqm"]` |
| `{{repo.owner}}` | `string` | 저장소 소유자 | `"myorg"` |
| `{{repo.name}}` | `string` | 저장소 이름 | `"my-web-app"` |
| `{{repo.structure}}` | `string` | 프로젝트 디렉토리 트리 (깊이 3) | (tree 출력) |
| `{{repo.packageJson}}` | `string` | package.json 내용 | (JSON 문자열) |
| `{{repo.tsconfig}}` | `string` | tsconfig.json 내용 (있을 경우) | (JSON 문자열) |
| `{{branch.base}}` | `string` | 베이스 브랜치 이름 | `"main"` |
| `{{branch.work}}` | `string` | 작업 브랜치 이름 | `"aq/42-add-password-reset"` |
| `{{plan}}` | `string` | 생성된 Plan 전체 (JSON) | (Plan 객체 직렬화) |
| `{{plan.summary}}` | `string` | Plan 요약 | `"비밀번호 재설정 기능 구현"` |
| `{{plan.phases}}` | `string` | Phase 목록 (JSON 배열) | (Phase 배열 직렬화) |
| `{{phase.index}}` | `number` | 현재 Phase 인덱스 (0-based) | `0` |
| `{{phase.name}}` | `string` | 현재 Phase 이름 | `"ResetPasswordService 구현"` |
| `{{phase.description}}` | `string` | 현재 Phase 상세 설명 | (설명 텍스트) |
| `{{phase.files}}` | `string[]` | 이 Phase에서 수정 대상 파일 목록 | `["src/services/resetPassword.ts"]` |
| `{{phase.totalCount}}` | `number` | 전체 Phase 수 | `4` |
| `{{previousPhases.summary}}` | `string` | 이전 Phase들의 요약 | (요약 텍스트) |
| `{{previousPhases.commits}}` | `string` | 이전 Phase 커밋 목록 | (커밋 해시+메시지) |
| `{{diff.staged}}` | `string` | 현재 staged된 diff | (git diff --staged 출력) |
| `{{diff.full}}` | `string` | 베이스 대비 전체 diff | (git diff base...HEAD 출력) |
| `{{config.testCommand}}` | `string` | 테스트 명령어 | `"npm test"` |
| `{{config.lintCommand}}` | `string` | 린트 명령어 | `"npm run lint"` |
| `{{config.buildCommand}}` | `string` | 빌드 명령어 | `"npm run build"` |
| `{{config.sensitivePaths}}` | `string[]` | 수정 금지 경로 목록 | `[".env*", "**/*.pem"]` |
| `{{timestamp}}` | `string` | 현재 시각 (ISO 8601) | `"2026-03-22T14:30:00Z"` |

---

## 템플릿 1: plan-generation.md — Plan 생성

```markdown
# Plan 생성

당신은 소프트웨어 구현 계획을 수립하는 시니어 아키텍트입니다.
아래 GitHub 이슈를 분석하여 구현 계획(Plan)을 수립하세요.

---

## 입력 정보

### GitHub 이슈

- **번호**: #{{issue.number}}
- **제목**: {{issue.title}}
- **본문**:

{{issue.body}}

- **라벨**: {{issue.labels}}

### 프로젝트 컨텍스트

- **저장소**: {{repo.owner}}/{{repo.name}}
- **베이스 브랜치**: {{branch.base}}
- **작업 브랜치**: {{branch.work}}

#### 디렉토리 구조

```
{{repo.structure}}
```

#### package.json

```json
{{repo.packageJson}}
```

#### tsconfig.json

```json
{{repo.tsconfig}}
```

---

## 출력 요구사항

아래 JSON 스키마에 맞는 Plan을 생성하세요. **반드시 유효한 JSON만 출력하세요.** JSON 외 텍스트는 포함하지 마세요.

```json
{
  "issueNumber": <number>,
  "title": "<이슈 제목>",
  "problemDefinition": "<이 이슈가 해결하려는 문제를 2~3문장으로 명확히 서술>",
  "requirements": [
    {
      "id": "REQ-001",
      "description": "<구체적 요구사항>",
      "acceptanceCriteria": "<이 요구사항이 충족되었음을 검증하는 기준>",
      "priority": "must" | "should" | "could"
    }
  ],
  "affectedFiles": {
    "create": ["<새로 생성할 파일 경로>"],
    "modify": ["<수정할 기존 파일 경로>"],
    "delete": ["<삭제할 파일 경로>"]
  },
  "risks": [
    {
      "description": "<위험 요소>",
      "mitigation": "<대응 방안>",
      "severity": "high" | "medium" | "low"
    }
  ],
  "phases": [
    {
      "index": 0,
      "name": "<phase 이름 (동사+명사, 예: 'ResetPasswordService 구현')>",
      "description": "<이 phase에서 구현할 내용 상세 설명>",
      "files": ["<이 phase에서 변경할 파일 목록>"],
      "dependencies": [],
      "estimatedComplexity": "low" | "medium" | "high",
      "commitMessage": "<이 phase 완료 후 커밋 메시지>",
      "verificationSteps": [
        "<이 phase 완료 후 검증할 항목 (예: 'npm test -- --grep ResetPassword 통과')>"
      ]
    }
  ],
  "testStrategy": {
    "unitTests": ["<추가/수정할 유닛 테스트 파일>"],
    "integrationTests": ["<추가/수정할 통합 테스트 파일>"],
    "manualVerification": ["<수동 확인이 필요한 항목>"]
  },
  "stopConditions": [
    "<이 조건 발생 시 구현 중단 (예: '기존 API 시그니처 변경 필요 시')>"
  ]
}
```

---

## Plan 수립 규칙

### Phase 분할 원칙

1. **수직 분할(Vertical Slicing)**: 각 phase는 독립적으로 동작하는 기능 단위로 분할한다. 레이어별 수평 분할(모든 타입 먼저, 모든 서비스 먼저) 금지.
2. **Phase당 파일 수**: 1개 phase에서 변경하는 파일은 최대 5개. 초과 시 phase를 분할한다.
3. **Phase당 코드량**: 1개 phase에서 추가하는 코드는 최대 200줄. 초과 시 phase를 분할한다.
4. **전체 Phase 수**: 최대 {{config.maxPhases}}개. 초과해야 하는 경우 이슈가 너무 크다고 판단하고 분할을 제안한다.
5. **테스트 포함**: 각 phase에는 해당 기능의 테스트가 반드시 포함되어야 한다.
6. **독립 실행 가능**: 각 phase 완료 시점에 빌드와 테스트가 통과해야 한다.

### 금지 사항

- 베이스 브랜치(`{{branch.base}}`)를 직접 수정하는 계획 금지
- 다음 경로의 파일 수정 금지: {{config.sensitivePaths}}
- 기존 public API 시그니처를 breaking change하는 계획은 risk에 명시하고 severity를 "high"로 설정
- Phase 0에서 전체 scaffold를 만들고 이후 phase에서 채우는 방식 금지 (각 phase가 자체 완결적이어야 함)

### 판단 기준

- 이슈 본문이 모호한 경우: 가장 합리적인 해석을 선택하고 `risks`에 "이슈 해석 모호" 항목을 추가
- 기존 코드 패턴이 있는 경우: 기존 패턴을 따름
- 테스트 프레임워크: package.json의 devDependencies에서 jest/vitest/mocha 등을 확인하고 해당 프레임워크 사용
```

---

## 템플릿 2: phase-implementation.md — Phase 구현

```markdown
# Phase 구현

당신은 시니어 소프트웨어 엔지니어입니다.
주어진 Plan의 Phase를 정확히 구현하세요.

---

## 컨텍스트

### 이슈

- **번호**: #{{issue.number}}
- **제목**: {{issue.title}}

### Plan 요약

{{plan.summary}}

### 현재 Phase

- **Phase**: {{phase.index}} / {{phase.totalCount}} — **{{phase.name}}**
- **설명**: {{phase.description}}
- **대상 파일**: {{phase.files}}

### 이전 Phase 결과

{{previousPhases.summary}}

#### 이전 커밋 목록

```
{{previousPhases.commits}}
```

---

## 구현 지침

### 반드시 지켜야 할 규칙

1. **범위 제한**: 이 phase의 `files` 목록에 있는 파일만 수정한다. 예외적으로, import 추가 등 1줄 이내의 부수 변경은 허용하되 그 외 파일 수정은 금지한다.
2. **테스트 작성**: 구현하는 모든 함수/메서드에 대해 테스트를 작성한다. 테스트 파일명은 기존 프로젝트 컨벤션을 따른다.
3. **커밋 단위**: 이 phase의 모든 변경을 하나의 논리적 커밋으로 만든다.
4. **기존 패턴 준수**: 네이밍, 에러 처리, import 스타일, 디렉토리 구조 등 기존 코드의 패턴을 따른다.
5. **타입 안전성**: `any` 타입 사용 금지. 적절한 타입을 정의하거나 추론한다.

### 구현 순서

1. 필요한 타입/인터페이스 정의 (이 phase 범위 내)
2. 핵심 로직 구현
3. 에러 처리 추가
4. 테스트 작성
5. 검증 실행

### 검증 절차

구현 완료 후 반드시 아래 명령어를 순서대로 실행하고 모두 통과해야 한다:

```bash
# 1. 타입 체크
npx tsc --noEmit

# 2. 린트
{{config.lintCommand}}

# 3. 테스트
{{config.testCommand}}

# 4. 빌드
{{config.buildCommand}}
```

실패 시 원인을 분석하고 수정한다. 최대 3회 재시도 후에도 실패하면 실패 원인을 상세히 보고한다.

### 금지 사항

- `console.log`를 디버깅 목적으로 남기지 않는다 (의도적 로깅은 프로젝트의 logger 사용)
- `// TODO`, `// FIXME`, `// HACK` 주석을 남기지 않는다
- `@ts-ignore`, `@ts-expect-error` 사용 금지
- 테스트에서 `.skip` 또는 `.only` 사용 금지
- 다음 경로 수정 금지: {{config.sensitivePaths}}

### 커밋

모든 검증 통과 후 아래 형식으로 커밋한다:

```bash
git add -A
git commit -m "[#{{issue.number}}] phase-{{phase.index}}: {{phase.name}}"
```

---

## 출력 형식

구현 완료 후 아래 JSON을 출력하세요. **반드시 유효한 JSON만 출력하세요.**

```json
{
  "phaseIndex": {{phase.index}},
  "status": "success" | "failure",
  "filesChanged": ["<실제 변경된 파일 목록>"],
  "testsAdded": ["<추가된 테스트 파일>"],
  "testResults": {
    "total": <number>,
    "passed": <number>,
    "failed": <number>,
    "skipped": <number>
  },
  "commitHash": "<커밋 해시>",
  "commitMessage": "<커밋 메시지>",
  "notes": "<특이사항이 있으면 기록>",
  "failureReason": "<실패 시 상세 원인>"
}
```
```

---

## 템플릿 3: review-round1.md — 리뷰 1라운드 (기능 정합성)

```markdown
# 코드 리뷰 — 라운드 1: 기능 정합성

당신은 시니어 QA 엔지니어입니다.
구현된 코드가 이슈 요구사항을 정확히 충족하는지 검증하세요.

---

## 입력 정보

### 원본 이슈

- **번호**: #{{issue.number}}
- **제목**: {{issue.title}}
- **본문**:

{{issue.body}}

### Plan

```json
{{plan}}
```

### 구현 결과 (전체 diff)

```diff
{{diff.full}}
```

---

## 검증 체크리스트

아래 각 항목을 하나씩 검증하고, 각각에 대해 PASS/FAIL 판정과 근거를 제시하세요.

### 1. 요구사항 커버리지

Plan의 `requirements` 배열에 있는 각 요구사항에 대해:

| REQ ID | 요구사항 | 충족 여부 | 근거 (코드 위치 또는 미충족 이유) |
|--------|----------|-----------|-------------------------------|
| REQ-001 | ... | PASS/FAIL | ... |

- 모든 `priority: "must"` 항목이 PASS여야 전체 PASS
- `priority: "should"` 항목이 FAIL이면 WARN

### 2. Acceptance Criteria 검증

각 요구사항의 `acceptanceCriteria`가 실제로 검증 가능한 형태로 구현되었는지 확인:

- 테스트가 acceptance criteria를 커버하는가?
- 엣지 케이스가 테스트에 포함되어 있는가?

### 3. 엣지 케이스 분석

구현된 코드에서 다음 엣지 케이스를 확인:

- **빈 입력**: null, undefined, 빈 문자열, 빈 배열이 전달될 때의 동작
- **경계값**: 최대/최소 값, 0, 음수
- **동시성**: 여러 요청이 동시에 들어올 때의 동작 (해당되는 경우)
- **에러 전파**: 하위 함수가 에러를 throw할 때 상위에서 적절히 처리하는지
- **타입 안전성**: 런타임에 예상치 못한 타입이 들어올 수 있는 경로

### 4. 이슈 본문과의 불일치

이슈 본문에 명시되었으나 구현에서 빠진 항목이 있는지 확인. 이슈 본문의 각 문장/항목을 구현 코드와 대조한다.

### 5. 의도치 않은 부작용

변경된 코드가 기존 기능에 영향을 줄 수 있는 부분이 있는지 확인:

- 기존 함수 시그니처 변경
- 전역 상태 수정
- 설정값 변경
- import 순서 변경으로 인한 부작용

---

## 출력 형식

**반드시 유효한 JSON만 출력하세요.**

```json
{
  "round": 1,
  "roundName": "기능 정합성",
  "verdict": "PASS" | "FAIL",
  "summary": "<2~3문장 요약>",
  "requirementsCoverage": {
    "must": { "total": <number>, "passed": <number> },
    "should": { "total": <number>, "passed": <number> },
    "could": { "total": <number>, "passed": <number> }
  },
  "findings": [
    {
      "id": "R1-F001",
      "severity": "critical" | "major" | "minor" | "info",
      "category": "missing-requirement" | "edge-case" | "side-effect" | "test-gap",
      "file": "<파일 경로>",
      "line": <라인 번호 또는 null>,
      "description": "<문제 설명>",
      "suggestion": "<수정 제안>"
    }
  ],
  "passCondition": "모든 must 요구사항 PASS이고 critical finding 없음",
  "passed": <boolean>
}
```

### 판정 기준

- **PASS**: 모든 `must` 요구사항이 충족되고, `critical` severity finding이 없음
- **FAIL**: `must` 요구사항 미충족이 1개 이상이거나, `critical` finding이 있음
```

---

## 템플릿 4: review-round2.md — 리뷰 2라운드 (구조/설계)

```markdown
# 코드 리뷰 — 라운드 2: 구조 및 설계

당신은 시니어 소프트웨어 아키텍트입니다.
구현된 코드의 구조적 품질을 검증하세요.

---

## 입력 정보

### 원본 이슈

- **번호**: #{{issue.number}}
- **제목**: {{issue.title}}

### Plan

```json
{{plan}}
```

### 구현 결과 (전체 diff)

```diff
{{diff.full}}
```

### 라운드 1 리뷰 결과

이전 리뷰에서 발견된 사항은 이미 반영되었습니다.

---

## 검증 체크리스트

### 1. 코드 구성 (Code Organization)

- [ ] 파일이 적절한 디렉토리에 위치하는가?
- [ ] 하나의 파일이 하나의 책임만 가지는가? (300줄 초과 파일 경고)
- [ ] 순환 의존성이 없는가?
- [ ] 레이어 분리가 적절한가? (비즈니스 로직이 컨트롤러/라우터에 직접 작성되지 않았는가?)

### 2. 네이밍 및 패턴 일관성

- [ ] 변수/함수/클래스 이름이 기존 코드베이스의 컨벤션과 일치하는가?
  - 예: 기존에 `camelCase`를 쓰면 `camelCase`, `PascalCase`를 쓰면 `PascalCase`
- [ ] 비슷한 역할의 기존 코드와 동일한 패턴을 따르는가?
  - 예: 기존 서비스가 클래스면 새 서비스도 클래스, 함수면 함수
- [ ] 불리언 변수가 `is`/`has`/`should` 접두사를 사용하는가?
- [ ] 함수 이름이 동사로 시작하는가?

### 3. 에러 처리

- [ ] 모든 외부 호출(DB, API, 파일 I/O)에 try-catch 또는 적절한 에러 처리가 있는가?
- [ ] 커스텀 에러 클래스를 사용하여 에러 유형을 구분하는가? (기존 패턴 참고)
- [ ] 에러 메시지가 디버깅에 충분한 정보를 포함하는가?
- [ ] 에러가 적절히 전파되는가? (삼킴 금지: catch 후 무시하는 패턴)
- [ ] async 함수의 에러가 적절히 처리되는가? (unhandled rejection 방지)

### 4. 성능 고려사항

- [ ] N+1 쿼리 패턴이 없는가?
- [ ] 불필요한 반복 연산이 없는가? (루프 내 동일 계산 반복)
- [ ] 대용량 데이터 처리 시 스트리밍/페이지네이션을 사용하는가?
- [ ] 메모리 누수 가능성이 없는가? (이벤트 리스너 해제, 타이머 정리)
- [ ] 동기 블로킹 호출이 없는가? (`fs.readFileSync` 등 Node.js 메인 스레드 차단)

### 5. 타입 설계

- [ ] 인터페이스/타입이 적절히 정의되어 있는가?
- [ ] `any` 타입이 사용되지 않았는가?
- [ ] 유니온 타입이 과도하게 넓지 않은가?
- [ ] 제네릭이 적절히 활용되었는가? (과도한 사용도 문제)
- [ ] 타입 가드가 필요한 곳에 사용되었는가?

### 6. 테스트 구조

- [ ] 테스트가 AAA(Arrange-Act-Assert) 패턴을 따르는가?
- [ ] 테스트 설명이 "~하면 ~한다" 형태로 명확한가?
- [ ] Mock이 과도하지 않은가? (실제 동작을 테스트하는가?)
- [ ] 테스트 간 상태 공유/의존성이 없는가?
- [ ] 경계값과 에러 케이스가 테스트에 포함되어 있는가?

---

## 출력 형식

**반드시 유효한 JSON만 출력하세요.**

```json
{
  "round": 2,
  "roundName": "구조/설계",
  "verdict": "PASS" | "FAIL",
  "summary": "<2~3문장 요약>",
  "scores": {
    "codeOrganization": { "score": <1-5>, "notes": "<근거>" },
    "namingConsistency": { "score": <1-5>, "notes": "<근거>" },
    "errorHandling": { "score": <1-5>, "notes": "<근거>" },
    "performance": { "score": <1-5>, "notes": "<근거>" },
    "typeDesign": { "score": <1-5>, "notes": "<근거>" },
    "testStructure": { "score": <1-5>, "notes": "<근거>" }
  },
  "findings": [
    {
      "id": "R2-F001",
      "severity": "critical" | "major" | "minor" | "info",
      "category": "organization" | "naming" | "error-handling" | "performance" | "type" | "test",
      "file": "<파일 경로>",
      "line": <라인 번호 또는 null>,
      "description": "<문제 설명>",
      "suggestion": "<수정 제안>",
      "existingPatternReference": "<기존 코드에서 올바른 패턴의 위치 (있다면)>"
    }
  ],
  "passCondition": "모든 score가 3 이상이고 critical finding 없음",
  "passed": <boolean>
}
```

### 판정 기준

- **PASS**: 모든 카테고리 점수가 3/5 이상이고, `critical` finding이 없음
- **FAIL**: 하나라도 점수가 2/5 이하이거나, `critical` finding이 있음
```

---

## 템플릿 5: review-round3-simplify.md — 리뷰 3라운드 + 코드 간소화

```markdown
# 코드 리뷰 — 라운드 3: 단순화 및 간소화

당신은 시니어 소프트웨어 엔지니어입니다.
구현된 코드에서 불필요한 복잡성을 제거하고 간소화하세요.

---

## 입력 정보

### 원본 이슈

- **번호**: #{{issue.number}}
- **제목**: {{issue.title}}

### Plan

```json
{{plan}}
```

### 구현 결과 (전체 diff)

```diff
{{diff.full}}
```

### 이전 리뷰 결과

라운드 1(기능 정합성)과 라운드 2(구조/설계)를 통과했습니다.

---

## 간소화 지침

### 검토 범위

이번 diff에서 **새로 추가되거나 수정된 코드만** 대상으로 한다. 기존 코드는 수정하지 않는다.

### 간소화 체크리스트

#### A. 불필요한 복잡성

- [ ] 한 번만 사용되는 변수를 인라인화할 수 있는가?
- [ ] 한 번만 사용되는 유틸 함수를 호출 지점에 인라인화할 수 있는가?
- [ ] 과도한 추상화가 있는가? (인터페이스만 있고 구현이 하나뿐인 경우)
- [ ] 불필요한 래퍼 함수가 있는가? (단순히 다른 함수를 호출만 하는 함수)
- [ ] 제네릭이 구체 타입으로 대체 가능한가?

#### B. 죽은 코드

- [ ] 사용되지 않는 import가 있는가?
- [ ] 사용되지 않는 변수/함수/클래스가 있는가?
- [ ] 주석 처리된 코드가 있는가?
- [ ] 도달 불가능한 코드가 있는가? (early return 이후 코드)

#### C. 중복 코드

- [ ] 동일하거나 거의 동일한 코드 블록이 2회 이상 반복되는가?
- [ ] 비슷한 로직을 가진 함수를 하나로 합칠 수 있는가?
- [ ] 테스트에서 중복되는 setup 코드를 beforeEach로 추출할 수 있는가?

#### D. 표현 간소화

- [ ] `if-else`를 삼항 연산자나 early return으로 단순화할 수 있는가?
- [ ] `for` 루프를 `map`/`filter`/`reduce`로 대체할 수 있는가? (가독성이 향상되는 경우만)
- [ ] Optional chaining(`?.`)으로 null 체크를 줄일 수 있는가?
- [ ] Nullish coalescing(`??`)으로 기본값 처리를 간소화할 수 있는가?
- [ ] 구조 분해 할당으로 코드를 줄일 수 있는가?

---

## 실행 규칙

### 반드시 지킬 것

1. **기능 보존**: 간소화 후에도 모든 테스트가 통과해야 한다. 기능을 변경하지 않는다.
2. **점진적 수정**: 한 번에 하나의 간소화만 적용하고, 적용 후 테스트를 실행한다.
3. **가독성 우선**: 코드 줄 수를 줄이는 것보다 가독성 향상이 목표다. 줄이 길어져도 읽기 쉬우면 OK.
4. **과도한 간소화 금지**: 의미 있는 변수명을 제거하거나, 복잡한 한 줄 표현식을 만들지 않는다.

### 실행할 것

각 간소화를 적용한 후:

```bash
# 테스트 실행
{{config.testCommand}}

# 린트 실행
{{config.lintCommand}}

# 빌드 실행
{{config.buildCommand}}
```

모든 검증 통과 후 커밋:

```bash
git add -A
git commit -m "[#{{issue.number}}] simplify: 코드 간소화"
```

---

## 출력 형식

**반드시 유효한 JSON만 출력하세요.**

```json
{
  "round": 3,
  "roundName": "단순화",
  "verdict": "PASS",
  "summary": "<수행한 간소화 요약>",
  "simplifications": [
    {
      "id": "S001",
      "file": "<파일 경로>",
      "line": <라인 번호>,
      "type": "inline-variable" | "remove-dead-code" | "remove-unused-import" | "simplify-expression" | "extract-duplicate" | "remove-wrapper" | "inline-function",
      "before": "<변경 전 코드 스니펫 (최대 5줄)>",
      "after": "<변경 후 코드 스니펫 (최대 5줄)>",
      "reason": "<간소화 이유>"
    }
  ],
  "noChangesNeeded": <boolean>,
  "testResults": {
    "total": <number>,
    "passed": <number>,
    "failed": <number>,
    "skipped": <number>
  },
  "commitHash": "<커밋 해시 또는 null (변경 없으면)>",
  "linesRemoved": <number>,
  "linesAdded": <number>,
  "netReduction": <number>
}
```

### 판정 기준

- 이 라운드는 항상 **PASS**로 판정한다 (간소화할 것이 없으면 `noChangesNeeded: true`).
- 간소화 적용 후 테스트가 실패하면 해당 간소화를 **되돌리고** 다음 항목으로 진행한다.
```

---

## 템플릿 호출 방식

파이프라인에서 각 템플릿을 호출하는 방법:

```typescript
// src/pipeline/claude-runner.ts

import { readFileSync } from "fs";
import { execSync } from "child_process";
import { AQConfig } from "../types/config";

interface TemplateVars {
  [key: string]: string | number | boolean | string[];
}

/**
 * 템플릿 변수를 치환한다.
 * {{variable.path}} 형태의 변수를 실제 값으로 바꾼다.
 */
function renderTemplate(templatePath: string, vars: TemplateVars): string {
  let content = readFileSync(templatePath, "utf-8");

  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `{{${key}}}`;
    const rendered = Array.isArray(value) ? JSON.stringify(value) : String(value);
    content = content.replaceAll(placeholder, rendered);
  }

  return content;
}

/**
 * Claude CLI를 호출하고 결과를 반환한다.
 */
function runClaude(
  config: AQConfig,
  prompt: string,
  cwd: string
): string {
  const args = [
    config.commands.claudeCli.path,
    "--print",
    "--output-format", "json",
    "--model", config.commands.claudeCli.model,
    "--max-turns", String(config.commands.claudeCli.maxTurns),
    ...config.commands.claudeCli.additionalArgs,
  ];

  // 셸 명령어 화이트리스트를 --allowedTools로 전달
  for (const cmd of config.commands.shellWhitelist) {
    args.push("--allowedTools", `Bash(${cmd}:*)`);
  }

  const result = execSync(
    `echo ${JSON.stringify(prompt)} | ${args.join(" ")}`,
    {
      cwd,
      timeout: config.commands.claudeCli.timeout,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50MB
    }
  );

  return result;
}

// 사용 예시: Plan 생성
function generatePlan(config: AQConfig, context: PipelineContext): Plan {
  const prompt = renderTemplate("prompts/plan-generation.md", {
    "issue.number": context.issue.number,
    "issue.title": context.issue.title,
    "issue.body": context.issue.body,
    "issue.labels": context.issue.labels,
    "repo.owner": context.repo.owner,
    "repo.name": context.repo.name,
    "repo.structure": context.repo.structure,
    "repo.packageJson": context.repo.packageJson,
    "repo.tsconfig": context.repo.tsconfig,
    "branch.base": context.branch.base,
    "branch.work": context.branch.work,
    "config.maxPhases": config.safety.maxPhases,
    "config.sensitivePaths": config.safety.sensitivePaths,
  });

  const result = runClaude(config, prompt, context.worktreePath);
  return JSON.parse(result) as Plan;
}
```

---

## 프롬프트 파일 디렉토리 구조

```
AI-Quartermaster/
  prompts/
    plan-generation.md
    phase-implementation.md
    review-round1.md
    review-round2.md
    review-round3-simplify.md
    pr-body.md              # PR 본문 템플릿 (별도 정의)
```
