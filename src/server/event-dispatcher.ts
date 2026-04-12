import { getLogger } from "../utils/logger.js";
import { listConfiguredRepos } from "../config/project-resolver.js";
import type { AQConfig } from "../types/config.js";
import { parseDependencies, checkCircularDependency } from "../queue/dependency-resolver.js";
import type { JobStore } from "../queue/job-store.js";
import { isAllowedOwner, hasInstanceOwnersConfigured } from "../safety/label-filter.js";

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
  /** 처리/스킵 사유 코드 (구조화된 분류) */
  reasonCode?: string;
  dependencies?: number[];
}

/**
 * Evaluates a GitHub webhook event and determines if it should trigger a pipeline.
 * Only processes "issues" events with "labeled" action containing the trigger label.
 */
export function dispatchEvent(
  eventType: string,
  payload: GitHubIssueEvent,
  triggerLabels: string[],
  config?: AQConfig,
  store?: JobStore
): DispatchResult {
  // Defensive validation: ensure required fields are present
  if (!payload?.issue?.number || !Array.isArray(payload?.issue?.labels) || !payload?.repository?.full_name) {
    return { shouldProcess: false, reasonCode: "invalid_payload", reason: "Malformed payload: missing required fields" };
  }

  // Only handle issue events
  if (eventType !== "issues") {
    return { shouldProcess: false, reasonCode: "ignored_event_type", reason: `Ignored event type: ${eventType}` };
  }

  // Only handle labeled action
  if (payload.action !== "labeled") {
    return { shouldProcess: false, reasonCode: "ignored_action", reason: `Ignored action: ${payload.action}` };
  }

  // Check if any label matches trigger labels
  const issueLabels = payload.issue.labels.map(l => l.name);
  const hasTriggerLabel = triggerLabels.length === 0 ||
    issueLabels.some(label => triggerLabels.includes(label));

  if (!hasTriggerLabel) {
    return {
      shouldProcess: false,
      reasonCode: "label_not_matched",
      reason: `No matching trigger label. Issue labels: [${issueLabels.join(", ")}], trigger: [${triggerLabels.join(", ")}]`,
    };
  }

  // Check if issue author is an allowed owner (when config is provided)
  if (config) {
    const instanceOwners = config.general.instanceOwners ?? [];
    if (!hasInstanceOwnersConfigured(instanceOwners)) {
      return {
        shouldProcess: false,
        reasonCode: "instance_owners_not_configured",
        reason: "instanceOwners is not configured. Set at least one owner in config to enable issue processing.",
      };
    }
    const author = payload.issue.user.login;
    if (!isAllowedOwner(author, instanceOwners)) {
      return {
        shouldProcess: false,
        reasonCode: "instance_owners_mismatch",
        reason: `Issue author @${author} is not in instanceOwners`,
      };
    }
  }

  // Check if repo is configured (when config is provided)
  const repo = payload.repository.full_name;
  if (config) {
    const configuredRepos = listConfiguredRepos(config);
    if (!configuredRepos.includes(repo)) {
      return {
        shouldProcess: false,
        reasonCode: "repo_not_configured",
        reason: `Repository ${repo} is not configured`,
      };
    }
  }

  // Parse dependencies from issue body (filter out self-references)
  const dependencies = parseDependencies(payload.issue.body ?? "")
    .filter(dep => dep !== payload.issue.number);

  // Check for circular dependencies when a store is available
  if (dependencies.length > 0 && store) {
    const hasCircular = checkCircularDependency(payload.issue.number, dependencies, store);
    if (hasCircular) {
      logger.warn(
        `Circular dependency detected for issue #${payload.issue.number} in ${repo} — skipping`
      );
      return {
        shouldProcess: false,
        reasonCode: "circular_dependency",
        reason: `Circular dependency detected for issue #${payload.issue.number}`,
      };
    }
  }

  // Check for active (queued/running) job to prevent duplicate webhook dispatch
  if (store) {
    const activeJob = store.findAnyByIssue(payload.issue.number, repo);
    if (activeJob && (activeJob.status === "queued" || activeJob.status === "running")) {
      logger.debug(
        `Skipping dispatch for issue #${payload.issue.number} in ${repo} — active job ${activeJob.id} (${activeJob.status})`
      );
      return {
        shouldProcess: false,
        reasonCode: "active_job_exists",
        reason: `Active job already exists for issue #${payload.issue.number} (${activeJob.status})`,
      };
    }
  }

  logger.info(`Dispatching pipeline for issue #${payload.issue.number} in ${repo}`);

  return {
    shouldProcess: true,
    issueNumber: payload.issue.number,
    repo,
    reasonCode: "trigger_label_matched",
    reason: "트리거 라벨 매칭으로 실행",
    ...(dependencies.length > 0 ? { dependencies } : {}),
  };
}
