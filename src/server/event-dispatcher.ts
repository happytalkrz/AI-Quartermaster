import { getLogger } from "../utils/logger.js";
import { listConfiguredRepos } from "../config/project-resolver.js";
import type { AQConfig } from "../types/config.js";

const logger = getLogger();

export interface GitHubIssueEvent {
  action: string;
  issue: {
    number: number;
    title: string;
    body: string;
    labels: Array<{ name: string }>;
    user: { login: string };
  };
  repository: {
    full_name: string;
    default_branch: string;
  };
}

export interface DispatchResult {
  shouldProcess: boolean;
  issueNumber?: number;
  repo?: string;
  reason?: string;
}

/**
 * Evaluates a GitHub webhook event and determines if it should trigger a pipeline.
 * Only processes "issues" events with "labeled" action containing the trigger label.
 */
export function dispatchEvent(
  eventType: string,
  payload: GitHubIssueEvent,
  triggerLabels: string[],
  config?: AQConfig
): DispatchResult {
  // Only handle issue events
  if (eventType !== "issues") {
    return { shouldProcess: false, reason: `Ignored event type: ${eventType}` };
  }

  // Only handle labeled action
  if (payload.action !== "labeled") {
    return { shouldProcess: false, reason: `Ignored action: ${payload.action}` };
  }

  // Check if any label matches trigger labels
  const issueLabels = payload.issue.labels.map(l => l.name);
  const hasTriggerLabel = triggerLabels.length === 0 ||
    issueLabels.some(label => triggerLabels.includes(label));

  if (!hasTriggerLabel) {
    return {
      shouldProcess: false,
      reason: `No matching trigger label. Issue labels: [${issueLabels.join(", ")}], trigger: [${triggerLabels.join(", ")}]`,
    };
  }

  // Check if repo is configured (when config is provided)
  const repo = payload.repository.full_name;
  if (config) {
    const configuredRepos = listConfiguredRepos(config);
    if (!configuredRepos.includes(repo)) {
      return {
        shouldProcess: false,
        reason: `Repository ${repo} is not configured`,
      };
    }
  }

  logger.info(`Dispatching pipeline for issue #${payload.issue.number} in ${repo}`);

  return {
    shouldProcess: true,
    issueNumber: payload.issue.number,
    repo,
  };
}
