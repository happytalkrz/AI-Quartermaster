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
