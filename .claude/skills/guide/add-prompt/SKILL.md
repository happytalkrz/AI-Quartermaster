---
name: add-prompt
description: This skill should be used when the user asks to "add prompt template", "프롬프트 추가", "add template", "템플릿 추가", or mentions prompts/ directory, renderTemplate, loadTemplate, template variables.
level: 3
---

# 프롬프트 템플릿 추가

## 템플릿 시스템

- 위치: `prompts/*.md`
- 변수 문법: `{{variable}}` 또는 `{variable}` (둘 다 지원)
- 중첩 접근: `{{config.testCommand}}`, `{{issue.number}}`
- 미해석 변수: 원본 유지 (에러 아님)
- 배열: 자동으로 `", "` 조인

## 추가 절차

### 1. 템플릿 작성 (`prompts/<name>.md`)

구조:
```markdown
# 제목

역할 부여 문장.

---

## 입력 정보
- **필드**: {{variable}}

## 출력 요구사항
**반드시 JSON만 출력.** 설명 금지.

## 제약 조건
1. ...
```

### 2. 호출 코드 작성

```typescript
import { resolve } from "path";
import { renderTemplate, loadTemplate } from "../prompt/template-renderer.js";

const templatePath = resolve(promptsDir, "<name>.md");
const template = loadTemplate(templatePath);
const rendered = renderTemplate(template, {
  issue: { number: String(issueNumber), title },
  config: { testCommand, lintCommand },
  // ...
});
```

### 3. 변수 전달 규칙

| 타입 | 처리 | 예시 |
|------|------|------|
| string | 그대로 | `title: "Fix bug"` |
| number | String() 변환 | `number: String(42)` |
| array | 자동 조인 | `files: ["a.ts", "b.ts"]` → `"a.ts, b.ts"` |
| object | 중첩 접근 | `config: { test: "npm test" }` → `{{config.test}}` |
| undefined | 빈 문자열 또는 원본 유지 | 빈 문자열 기본값 권장 |

### 4. Claude JSON 출력 파싱

구조화된 출력이 필요하면 `--json-schema` 사용:
```typescript
const result = await runClaude({
  prompt: rendered,
  cwd,
  config: claudeConfig,
  jsonSchema: JSON.stringify(schema),
});
const parsed = extractJson<T>(result.output);
```

## 프롬프트 품질 체크리스트

- [ ] 역할이 명확한가 ("당신은 시니어 아키텍트입니다")
- [ ] 출력 형식이 명시적인가 (JSON 스키마 포함)
- [ ] 제약 조건이 구체적인가 (수치, 파일 경로)
- [ ] 변수가 모두 연결되었는가 (렌더링 후 `{{`가 남지 않는지)
