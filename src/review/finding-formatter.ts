import type { AnalystFinding, ReviewFinding } from "../types/review.js";

const SEVERITY_LABELS = {
  error: "🚨 ERROR",
  warning: "⚠️ WARNING",
  info: "ℹ️ INFO"
} as const;

export function formatAnalystFinding(finding: AnalystFinding): string {
  const severityLabel = SEVERITY_LABELS[finding.severity];
  const lines: string[] = [`**${severityLabel}**: ${finding.message}`];

  lines.push(`- **Type**: ${finding.type}`);
  lines.push(`- **Requirement**: ${finding.requirement}`);

  if (finding.implementation) {
    lines.push(`- **Implementation**: ${finding.implementation}`);
  }

  if (finding.suggestion) {
    lines.push(`- **Suggestion**: ${finding.suggestion}`);
  }

  return lines.join('\n');
}

export function formatReviewFinding(finding: ReviewFinding): string {
  const severityLabel = SEVERITY_LABELS[finding.severity];
  const lines: string[] = [`**${severityLabel}**: ${finding.message}`];

  if (finding.file) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    lines.push(`- **Location**: ${location}`);
  }

  if (finding.suggestion) {
    lines.push(`- **Suggestion**: ${finding.suggestion}`);
  }

  return lines.join('\n');
}

export function formatFindings(findings: (AnalystFinding | ReviewFinding)[]): string {
  if (findings.length === 0) {
    return "No findings to report.";
  }

  const formattedFindings = findings.map((finding, index) => {
    const formattedFinding = isAnalystFinding(finding)
      ? formatAnalystFinding(finding)
      : formatReviewFinding(finding);

    return `## Finding ${index + 1}\n\n${formattedFinding}`;
  });

  return formattedFindings.join('\n\n');
}

function isAnalystFinding(finding: AnalystFinding | ReviewFinding): finding is AnalystFinding {
  return 'type' in finding && 'requirement' in finding;
}