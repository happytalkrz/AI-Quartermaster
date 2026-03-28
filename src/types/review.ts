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

export interface ReviewPipelineResult {
  rounds: ReviewResult[];
  simplify?: SimplifyResult;
  allPassed: boolean;
}
