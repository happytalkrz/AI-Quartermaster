import { runCli, CliRunOptions } from "../utils/cli-runner.js";
import { sanitizeGhError, sanitizeErrorMessage } from "../utils/error-sanitizer.js";
import { memoize } from "./github-cache.js";

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string;
  state: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
}

async function fetchIssueInternal(
  repo: string,
  issueNumber: number,
  options?: { ghPath?: string; timeout?: number }
): Promise<GitHubIssue> {
  const ghPath = options?.ghPath ?? "gh";
  const cliOptions: CliRunOptions = {
    timeout: options?.timeout,
  };

  const result = await runCli(
    ghPath,
    ["issue", "view", String(issueNumber), "--repo", repo, "--json", "number,title,body,labels"],
    cliOptions
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to fetch issue #${issueNumber} from ${repo}: ${sanitizeGhError(result.stderr, result.stdout, "issue view")}`
    );
  }

  let parsed: {
    number: number;
    title: string;
    body: string;
    labels: Array<{ name: string } | string>;
  };

  try {
    parsed = JSON.parse(result.stdout);
  } catch (err: unknown) {
    throw new Error(
      `Failed to parse gh output for issue #${issueNumber}: ${sanitizeErrorMessage(result.stdout)}`
    );
  }

  const labels = parsed.labels.map((l) =>
    typeof l === "string" ? l : l.name
  );

  return {
    number: parsed.number,
    title: parsed.title,
    body: parsed.body,
    labels,
  };
}

async function fetchPRInternal(
  repo: string,
  prNumber: number,
  options?: { ghPath?: string; timeout?: number }
): Promise<GitHubPR> {
  const ghPath = options?.ghPath ?? "gh";
  const cliOptions: CliRunOptions = {
    timeout: options?.timeout,
  };

  const result = await runCli(
    ghPath,
    ["pr", "view", String(prNumber), "--repo", repo, "--json", "number,title,body,state,headRefName,headRefOid,baseRefName"],
    cliOptions
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to fetch PR #${prNumber} from ${repo}: ${sanitizeGhError(result.stderr, result.stdout, "pr view")}`
    );
  }

  let parsed: {
    number: number;
    title: string;
    body: string;
    state: string;
    headRefName: string;
    headRefOid: string;
    baseRefName: string;
  };

  try {
    parsed = JSON.parse(result.stdout);
  } catch (err: unknown) {
    throw new Error(
      `Failed to parse gh output for PR #${prNumber}: ${sanitizeErrorMessage(result.stdout)}`
    );
  }

  return {
    number: parsed.number,
    title: parsed.title,
    body: parsed.body,
    state: parsed.state,
    head: {
      ref: parsed.headRefName,
      sha: parsed.headRefOid,
    },
    base: {
      ref: parsed.baseRefName,
    },
  };
}

// Memoized versions with custom key functions
export const fetchIssue = memoize(fetchIssueInternal, {
  keyFn: (repo: string, issueNumber: number, options?: { ghPath?: string; timeout?: number }) =>
    `issue:${repo}:${issueNumber}`,
});

export const fetchPR = memoize(fetchPRInternal, {
  keyFn: (repo: string, prNumber: number, options?: { ghPath?: string; timeout?: number }) =>
    `pr:${repo}:${prNumber}`,
});
