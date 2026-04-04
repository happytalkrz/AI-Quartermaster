import { runCli, CliRunOptions } from "../utils/cli-runner.js";

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
      `Failed to fetch issue #${issueNumber} from ${repo}: ${result.stderr || result.stdout}`
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
      `Failed to parse gh output for issue #${issueNumber}: ${result.stdout}`
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
