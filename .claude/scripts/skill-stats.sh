#!/bin/bash
# AQM 스킬 사용 통계 리포트
#
# 사용법:
#   bash .claude/scripts/skill-stats.sh              # 전체 통계
#   bash .claude/scripts/skill-stats.sh --days 7     # 최근 7일

set -e

LOG_FILE=".claude/skill-usage.jsonl"
DAYS=0

while [[ $# -gt 0 ]]; do
    case $1 in
        --days) DAYS="$2"; shift 2 ;;
        -h|--help)
            echo "스킬 사용 통계 리포트"
            echo ""
            echo "사용법: bash $0 [옵션]"
            echo "  --days N     최근 N일 통계만 표시"
            echo "  -h           도움말"
            exit 0
            ;;
        *) echo "알 수 없는 옵션: $1"; exit 1 ;;
    esac
done

if [ ! -f "$LOG_FILE" ]; then
    echo "로그 파일이 없습니다: $LOG_FILE"
    echo "스킬을 사용하면 자동으로 생성됩니다."
    exit 0
fi

if [ "$DAYS" -gt 0 ]; then
    SINCE=$(date -d "-${DAYS} days" -Iseconds 2>/dev/null || date -v-${DAYS}d -Iseconds 2>/dev/null)
    DATA=$(jq -c "select(.ts >= \"$SINCE\")" "$LOG_FILE")
else
    DATA=$(cat "$LOG_FILE")
fi

TOTAL=$(echo "$DATA" | wc -l)
if [ "$TOTAL" -eq 0 ] || [ -z "$DATA" ]; then
    echo "해당 기간에 스킬 사용 기록이 없습니다."
    exit 0
fi

UNIQUE_SESSIONS=$(echo "$DATA" | jq -r '.session' | sort -u | wc -l)
PERIOD_START=$(echo "$DATA" | head -1 | jq -r '.ts' | cut -dT -f1)
PERIOD_END=$(echo "$DATA" | tail -1 | jq -r '.ts' | cut -dT -f1)

echo ""
echo "===== AQM 스킬 사용 통계 ====="
echo "기간: $PERIOD_START ~ $PERIOD_END"
echo "총 로드: ${TOTAL}회 | 세션: ${UNIQUE_SESSIONS}개"
echo ""

echo "── 스킬별 사용 빈도 ──"
echo "$DATA" | jq -r '.skill' | sort | uniq -c | sort -rn | while read count name; do
    bar=$(printf '%*s' "$count" '' | tr ' ' '█')
    printf "  %-25s %3d회  %s\n" "$name" "$count" "$bar"
done
echo ""

# 미사용 스킬 탐지
echo "── 미사용 스킬 ──"
ALL_SKILLS=$(ls .claude/skills/*.md 2>/dev/null | xargs -I{} basename {} .md)
USED_SKILLS=$(echo "$DATA" | jq -r '.skill' | sort -u)
UNUSED=""
for skill in $ALL_SKILLS; do
    if ! echo "$USED_SKILLS" | grep -q "^${skill}$"; then
        UNUSED="$UNUSED  - $skill\n"
    fi
done
if [ -n "$UNUSED" ]; then
    echo -e "$UNUSED"
else
    echo "  전체 스킬 사용됨"
fi
echo ""
echo "============================="
