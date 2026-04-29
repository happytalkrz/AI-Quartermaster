/**
 * Plan JSON 응답 복구 헬퍼 (#800-2).
 *
 * 배경: Claude가 Plan JSON 응답에서 자주 다음 형태의 escape 미스를 만든다.
 *   - 문자열 값 안에 escape 안 된 raw newline / tab / control char 삽입
 *   - " (U+201C/D), ' (U+2018/9) 같은 curly quote가 string 시작/종료 위치에 등장
 *   - 마지막 멤버 뒤 trailing comma (`,}` 또는 `,]`)
 *
 * 본 모듈은 JSON.parse가 실패한 응답을 받아 위 케이스를 정규화한 새 문자열을 돌려준다.
 * 정규화로도 파싱이 안 되면 호출부가 다음 fallback으로 넘어간다 (truncation recovery 등).
 *
 * 비목표: 의미 변경 없는 lexical 복구만. 키/값 구조 추측이나 누락 필드 채움은 하지 않는다.
 */

/**
 * 문자열 내부에 들어온 escape 안 된 control char 들을 escape 처리한 새 문자열을 만든다.
 * - LF(0x0a) → "\\n", CR(0x0d) → "\\r", TAB(0x09) → "\\t"
 * - 그 외 0x00–0x1F → "\\u00XX"
 * 문자열 외부에서는 손대지 않는다.
 */
export function escapeRawControlInsideStrings(text: string): string {
  const out: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);

    if (escape) {
      out.push(ch);
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      out.push(ch);
      escape = true;
      continue;
    }
    if (ch === '"') {
      out.push(ch);
      inString = !inString;
      continue;
    }

    if (inString && code < 0x20) {
      if (code === 0x0a) out.push("\\n");
      else if (code === 0x0d) out.push("\\r");
      else if (code === 0x09) out.push("\\t");
      else out.push("\\u" + code.toString(16).padStart(4, "0"));
      continue;
    }

    out.push(ch);
  }

  return out.join("");
}

/**
 * curly quote를 straight quote로 정규화한다.
 *
 * **주의:** 문자열 *값 내부*에 들어간 curly quote를 바꾸면 의미가 달라질 수 있어
 * 보수적으로 적용 — JSON 구조에 영향을 주는 위치(따옴표가 string boundary로 잘못
 * 사용된 경우)에서만 효과가 있을 가능성이 큰 단순 치환을 한다.
 *
 * U+201C/D → "
 * U+2018/9 → '  (JSON에서 single quote는 키/값으로 사용 불가지만 결과를 망가뜨리진 않는다)
 */
export function normalizeCurlyQuotes(text: string): string {
  return text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

/**
 * 객체/배열의 마지막 멤버 뒤 trailing comma를 제거한다.
 * 문자열 내부의 콤마는 건드리지 않는다.
 */
export function stripTrailingCommas(text: string): string {
  const out: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      out.push(ch);
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      out.push(ch);
      escape = true;
      continue;
    }
    if (ch === '"') {
      out.push(ch);
      inString = !inString;
      continue;
    }
    if (inString) {
      out.push(ch);
      continue;
    }

    // outside string — 콤마 다음에 공백/개행 후 } 또는 ] 가 오면 콤마 삭제
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /[\s\n\r\t]/.test(text[j])) j++;
      if (j < text.length && (text[j] === "}" || text[j] === "]")) {
        // skip the comma
        continue;
      }
    }

    out.push(ch);
  }

  return out.join("");
}

/**
 * 위 3가지 정규화를 순서대로 적용한 결과를 돌려준다.
 *
 * 적용 순서:
 *  1. control char escape — JSON 구조 분석 가능 상태로 우선 복구
 *  2. trailing comma 제거 — boundary 정리
 *  3. curly quote 정규화 — 마지막 변환은 내용에 영향 줄 수 있어 가장 뒤
 */
export function repairPlanJson(text: string): string {
  return normalizeCurlyQuotes(stripTrailingCommas(escapeRawControlInsideStrings(text)));
}
