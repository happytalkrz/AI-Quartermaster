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
 * Checks if instanceOwners is configured (non-empty).
 * Returns false if instanceOwners is empty or undefined, meaning no owners are set.
 */
export function hasInstanceOwnersConfigured(instanceOwners: string[]): boolean {
  return instanceOwners.length > 0;
}

/**
 * Checks if the issue author is an allowed owner.
 * Returns true if instanceOwners is empty (all owners allowed).
 */
export function isAllowedOwner(
  issueAuthor: string,
  instanceOwners: string[]
): boolean {
  if (instanceOwners.length === 0) {
    return true;
  }
  return instanceOwners.includes(issueAuthor);
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
