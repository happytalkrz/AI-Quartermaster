/**
 * Checks if the issue has at least one allowed label.
 * Returns true if allowedLabels is empty (all labels allowed).
 * instanceLabel, if set, is implicitly treated as an allowed label.
 */
export function isAllowedLabel(
  issueLabels: string[],
  allowedLabels: string[],
  instanceLabel?: string
): boolean {
  const effectiveAllowed =
    instanceLabel !== undefined && instanceLabel !== ""
      ? [...allowedLabels, instanceLabel]
      : allowedLabels;

  if (effectiveAllowed.length === 0) {
    return true;
  }
  return issueLabels.some(label => effectiveAllowed.includes(label));
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
