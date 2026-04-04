#!/bin/bash
# 스킬 사용 통계 수집 Hook (PostToolUse:Read)
# .claude/skills/*.md 파일이 읽힐 때마다 JSONL 형식으로 로깅

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

# .claude/skills/{category}/{name}/SKILL.md 파일만 필터링
if [[ "$FILE_PATH" != *"/skills/"*"/SKILL.md" ]]; then
    exit 0
fi

# 스킬 정보 추출: .claude/skills/{category}/{name}/SKILL.md
SKILL_REL="${FILE_PATH##*/skills/}"
CATEGORY="${SKILL_REL%%/*}"
SKILL_NAME="${SKILL_REL#*/}"
SKILL_NAME="${SKILL_NAME%%/*}"

LOG_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude"
LOG_FILE="${LOG_DIR}/skill-usage.jsonl"

mkdir -p "$LOG_DIR"

echo "{\"ts\":\"$(date -Iseconds)\",\"skill\":\"${SKILL_NAME}\",\"category\":\"${CATEGORY}\",\"session\":\"${SESSION_ID}\"}" >> "$LOG_FILE"

exit 0
