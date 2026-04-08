---
name: workplan
description: This skill should be used when the user asks to "create workplan", "설계하자", "작업 계획", "plan work", "이슈 쪼개자", or mentions .claude/workplan, task decomposition, implementation design.
---

# 워크플랜 관리

## 구조

```
.claude/workplan/
  {plan-name}.md        # 활성 워크플랜
  old/                  # 완료된 워크플랜
    {plan-name}.md
```

## 워크플랜 작성 형식

```markdown
# {플랜 제목}

## 목표
한 줄 요약

## 현재 상태
현재 코드가 어떻게 되어있는지

## 목표 상태
어떻게 바뀌어야 하는지

## 이슈 분할

### 이슈 1: {제목}
- 파일: {관련 파일}
- 변경: {구체적 변경 내용}
- depends: 없음

### 이슈 2: {제목}
- 파일: {관련 파일}
- 변경: {구체적 변경 내용}
- depends: #이슈1
```

## 규칙

1. 설계는 `.claude/workplan/{name}.md`에 작성
2. 이슈는 `create-issue` 스킬 형식으로 생성
3. 이슈 간 의존성은 `depends: #N`으로 체이닝
4. 모든 이슈 완료 시 워크플랜을 `.claude/workplan/old/`로 이동
5. 워크플랜 없이 큰 작업을 이슈로 올리지 않는다
