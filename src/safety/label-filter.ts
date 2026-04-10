/**
 * Checks if the issue has at least one allowed label.
 * Returns true if allowedLabels is empty (all labels allowed).
 */
export function isAllowedLabel(
  issueLabels: string[],
  allowedLabels: string[]
): boolean {
  if (allowedLabels.length === 0) {
    return true;
  }
  return issueLabels.some(label => allowedLabels.includes(label));
}

/**
 * Determines effective trigger labels.
 * If instanceLabel is set, uses only that label (single-label mode).
 * Otherwise falls back to allowedLabels.
 */
export function getTriggerLabels(
  instanceLabel: string | undefined,
  allowedLabels: string[]
): string[] {
  if (instanceLabel !== undefined && instanceLabel !== "") {
    return [instanceLabel];
  }
  return allowedLabels;
}
