import { classifyError } from "./error-classifier.js";
import type {
  PipelineState,
  PhaseResult,
  Plan,
  ErrorHistoryEntry,
  ErrorCategory,
} from "../../types/pipeline.js";
import type { TemplateVariables } from "../../prompt/template-renderer.js";

const MAX_ERROR_MESSAGE_CHARS = 500;
const MAX_ERROR_HISTORY_CHARS = 500;
const MAX_LOGS_CHARS = 3000;

export interface DiagnosisInput {
  issueNumber: number;
  issueTitle: string;
  repo: string;
  state: PipelineState;
  failedPhase?: PhaseResult;
  plan?: Plan;
  /** JobLogger에서 수집한 로그 라인 배열 */
  recentLogs: string[];
  errorHistory: ErrorHistoryEntry[];
}

/**
 * 파이프라인 실패 시 진단에 필요한 컨텍스트를 수집하여
 * error-diagnosis.md 템플릿 변수로 조립합니다.
 *
 * 총 동적 콘텐츠 크기를 제한하여 진단 비용을 최소화합니다.
 */
export function collectErrorContext(input: DiagnosisInput): TemplateVariables {
  const { issueNumber, issueTitle, repo, state, failedPhase, plan, recentLogs, errorHistory } =
    input;

  // 에러 메시지 추출 및 크기 제한
  const rawErrorMessage =
    failedPhase?.error ?? failedPhase?.lastOutput ?? "Unknown error";
  const errorMessage = truncate(rawErrorMessage, MAX_ERROR_MESSAGE_CHARS);

  // 에러 카테고리 결정 (PhaseResult에 이미 있으면 우선 사용)
  const errorCategory: ErrorCategory =
    failedPhase?.errorCategory ?? classifyError(rawErrorMessage);

  // Plan에서 Phase 상세 정보 조회
  const phaseFromPlan = plan?.phases.find(
    (p) => p.index === failedPhase?.phaseIndex
  );

  const phaseIndex = failedPhase?.phaseIndex ?? -1;
  const phaseName = failedPhase?.phaseName ?? "Unknown";
  const phaseDescription = phaseFromPlan?.description ?? "";
  const phaseTargetFiles = phaseFromPlan?.targetFiles.join(", ") ?? "";

  // 에러 히스토리 포매팅
  const errorHistoryText = formatErrorHistory(errorHistory, MAX_ERROR_HISTORY_CHARS);

  // 최근 로그 포매팅 (마지막 100줄 기준, 크기 제한 적용)
  const recentLogsText = formatRecentLogs(recentLogs, MAX_LOGS_CHARS);

  return {
    issue: {
      number: String(issueNumber),
      title: issueTitle,
    },
    repo,
    state,
    errorCategory,
    errorMessage,
    phase: {
      index: String(phaseIndex),
      name: phaseName,
      description: phaseDescription,
      targetFiles: phaseTargetFiles,
    },
    recentLogs: recentLogsText,
    errorHistory: errorHistoryText,
  };
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

function formatErrorHistory(history: ErrorHistoryEntry[], maxChars: number): string {
  if (history.length === 0) return "(이력 없음)";

  const lines = history.map(
    (entry) =>
      `[시도 ${entry.attempt}] ${entry.errorCategory}: ${entry.errorMessage.slice(0, 120)} (${entry.timestamp})`
  );

  // 최신 항목을 앞에 두고 예산 내에서 포함
  let result = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] + "\n";
    if (result.length + line.length > maxChars) break;
    result = line + result;
  }

  return result.trim() || "(이력 없음)";
}

function formatRecentLogs(logs: string[], maxChars: number): string {
  if (logs.length === 0) return "(로그 없음)";

  // 마지막 100줄만 대상으로
  const recentLines = logs.slice(-100);
  let result = recentLines.join("\n");

  if (result.length > maxChars) {
    const suffix = result.slice(-(maxChars - 25));
    result = "...(이전 로그 생략)...\n" + suffix;
  }

  return result;
}
