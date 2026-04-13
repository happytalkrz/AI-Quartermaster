import { runCli, CliRunOptions } from "../utils/cli-runner.js";
import { sanitizeGhError, sanitizeErrorMessage } from "../utils/error-sanitizer.js";
import { memoize, deleteCached } from "./github-cache.js";

/**
 * 캐시 정책: 이슈/PR 메타데이터는 5분 TTL로 캐시합니다.
 *
 * - 근거: 파이프라인 평균 실행 시간(~3분) 내에서는 일관성을 보장하면서,
 *         5분 후에는 최신 메타데이터(본문, 라벨, 제목 변경)를 반영합니다.
 * - 키 구조: "issue:{repo}:{number}" 또는 "pr:{repo}:{number}"
 * - 무효화 시점: 파이프라인 재처리 전, 또는 메타데이터 변경이 확인된 경우
 *               invalidateIssueCache / invalidatePRCache 를 호출합니다.
 */
const ISSUE_CACHE_TTL_MS = 5 * 60 * 1000; // 5분

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

// Memoized versions with TTL and custom key functions
export const fetchIssue = memoize(fetchIssueInternal, {
  ttl: ISSUE_CACHE_TTL_MS,
  keyFn: (repo: string, issueNumber: number, options?: { ghPath?: string; timeout?: number }) =>
    `issue:${repo}:${issueNumber}`,
});

export const fetchPR = memoize(fetchPRInternal, {
  ttl: ISSUE_CACHE_TTL_MS,
  keyFn: (repo: string, prNumber: number, options?: { ghPath?: string; timeout?: number }) =>
    `pr:${repo}:${prNumber}`,
});

/**
 * 특정 이슈의 캐시를 즉시 무효화합니다.
 * 파이프라인 재처리 전 또는 이슈 메타데이터 변경이 확인된 경우 호출하세요.
 */
export function invalidateIssueCache(repo: string, issueNumber: number): void {
  deleteCached(`issue:${repo}:${issueNumber}`);
}

/**
 * 특정 PR의 캐시를 즉시 무효화합니다.
 * 파이프라인 재처리 전 또는 PR 메타데이터 변경이 확인된 경우 호출하세요.
 */
export function invalidatePRCache(repo: string, prNumber: number): void {
  deleteCached(`pr:${repo}:${prNumber}`);
}
