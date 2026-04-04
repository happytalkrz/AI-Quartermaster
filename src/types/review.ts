export type ReviewVerdict = "PASS" | "FAIL";

export interface ReviewFinding {
  severity: "error" | "warning" | "info";
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  roundName: string;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
  summary: string;
  durationMs: number;
}

export interface SimplifyResult {
  applied: boolean;
  linesRemoved: number;
  linesAdded: number;
  filesModified: string[];
  testsPassed: boolean;
  rolledBack: boolean;
  summary: string;
}

export interface AnalystFinding {
  type: "missing" | "excess" | "mismatch";
  requirement: string;
  implementation?: string;
  severity: "error" | "warning" | "info";
  message: string;
  suggestion?: string;
}

export interface AnalystResult {
  verdict: "COMPLETE" | "INCOMPLETE" | "MISALIGNED";
  findings: AnalystFinding[];
  summary: string;
  coverage: {
    implemented: string[];
    missing: string[];
    excess: string[];
  };
  durationMs: number;
  costUsd?: number;
  usage?: import("./pipeline.js").UsageInfo;
}

export interface ReviewFixAttempt {
  attempt: number;
  findingsSnapshot: {
    analystFindings?: AnalystFinding[];
    reviewFindings: ReviewFinding[];
  };
  fixResult: {
    success: boolean;
    filesModified: string[];
    summary: string;
    error?: string;
  };
}

export interface ReviewVariables {
  issue: { number: string; title: string; body: string };
  plan: { summary: string };
  diff: { full: string };
  config: { testCommand: string; lintCommand: string };
  skillsContext: string;
}

export interface ReviewPipelineResult {
  analyst?: AnalystResult;
  rounds: ReviewResult[];
  simplify?: SimplifyResult;
  fixAttempts?: ReviewFixAttempt[];
  allPassed: boolean;
}

/**
 * 분할 리뷰 정보를 나타내는 인터페이스
 */
export interface SplitReviewInfo {
  /** 총 분할 수 */
  totalSplits: number;
  /** 현재 분할 인덱스 (0부터 시작) */
  currentSplit: number;
  /** 분할 기준 (예: "file", "size") */
  splitBy: string;
}

/**
 * 분할 리뷰 결과에 분할 정보를 포함하는 확장된 인터페이스
 */
export interface SplitReviewResult extends ReviewResult {
  /** 분할 리뷰 정보 */
  splitInfo?: SplitReviewInfo;
}
