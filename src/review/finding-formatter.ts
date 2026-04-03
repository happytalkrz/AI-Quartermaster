import type { AnalystFinding, ReviewFinding } from "../types/review.js";

/**
 * Maps severity levels to emoji and label pairs
 */
const SEVERITY_LABELS = {
  error: "🚨 ERROR",
  warning: "⚠️ WARNING",
  info: "ℹ️ INFO"
} as const;

/**
 * Formats a single AnalystFinding into prompt-ready text
 */
export function formatAnalystFinding(finding: AnalystFinding): string {
  const severityLabel = SEVERITY_LABELS[finding.severity];
  const lines: string[] = [`**${severityLabel}**: ${finding.message}`];

  // Add type and requirement info
  lines.push(`- **Type**: ${finding.type}`);
  lines.push(`- **Requirement**: ${finding.requirement}`);

  // Add implementation info if present
  if (finding.implementation) {
    lines.push(`- **Implementation**: ${finding.implementation}`);
  }

  // Add suggestion if present
  if (finding.suggestion) {
    lines.push(`- **Suggestion**: ${finding.suggestion}`);
  }

  return lines.join('\n');
}

/**
 * Formats a single ReviewFinding into prompt-ready text
 */
export function formatReviewFinding(finding: ReviewFinding): string {
  const severityLabel = SEVERITY_LABELS[finding.severity];
  const lines: string[] = [`**${severityLabel}**: ${finding.message}`];

  // Add file and line info if present
  if (finding.file) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    lines.push(`- **Location**: ${location}`);
  }

  // Add suggestion if present
  if (finding.suggestion) {
    lines.push(`- **Suggestion**: ${finding.suggestion}`);
  }

  return lines.join('\n');
}

/**
 * Formats an array of mixed findings into prompt-ready text
 */
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

/**
 * Type guard to distinguish AnalystFinding from ReviewFinding
 */
function isAnalystFinding(finding: AnalystFinding | ReviewFinding): finding is AnalystFinding {
  return 'type' in finding && 'requirement' in finding;
}