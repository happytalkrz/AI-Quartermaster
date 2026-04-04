import { runCli, CliRunOptions } from "../utils/cli-runner.js";
import { sanitizeGhError, sanitizeErrorMessage } from "../utils/error-sanitizer.js";
import { getCached, setCached } from "./github-cache.js";

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export async function fetchIssue(
  repo: string,
  issueNumber: number,
  options?: { ghPath?: string; timeout?: number }
): Promise<GitHubIssue> {
  // 캐시 키 생성: issue:{repo}:{issueNumber}
  const cacheKey = `issue:${repo}:${issueNumber}`;

  // 캐시에서 조회
  const cached = getCached<GitHubIssue>(cacheKey);
  if (cached) {
    return cached;
  }

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

  const issue: GitHubIssue = {
    number: parsed.number,
    title: parsed.title,
    body: parsed.body,
    labels,
  };

  // 결과를 캐시에 저장
  setCached(cacheKey, issue);

  return issue;
}
