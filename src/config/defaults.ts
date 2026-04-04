import { AQConfig } from "../types/config.js";

export const DEFAULT_CONFIG: AQConfig = {
  general: {
    projectName: "ai-quartermaster",
    logLevel: "info",
    logDir: "logs",
    dryRun: false,
    locale: "en",
    concurrency: 1,
    stuckTimeoutMs: 600000,
    pollingIntervalMs: 60000,
    maxJobs: 500,
    autoUpdate: false,
  },
  git: {
    defaultBaseBranch: "main",
    branchTemplate: "aq/{{issueNumber}}-{{slug}}",
    commitMessageTemplate: "[#{{issueNumber}}] {{phase}}: {{summary}}",
    remoteAlias: "origin",
    allowedRepos: [],
    gitPath: "git",
    fetchDepth: 1,
    signCommits: false,
  },
  worktree: {
    rootPath: ".worktrees",
    cleanupOnSuccess: true,
    cleanupOnFailure: false,
    maxAge: "24h",
    dirTemplate: "{{issueNumber}}-{{slug}}",
  },
  commands: {
    claudeCli: {
      path: "claude",
      model: "claude-opus-4-5",
      models: {
        plan: "claude-opus-4-5",
        phase: "claude-sonnet-4-20250514",
        review: "claude-haiku-4-5-20251001",
        fallback: "claude-sonnet-4-20250514",
      },
      maxTurns: 60,
      maxTurnsPerMode: {
        economy: 30,
        standard: 60,
        thorough: 120,
      },
      timeout: 600000,
      additionalArgs: [],
      retry: {
        maxRetries: 3,
        initialDelayMs: 5000,
        maxDelayMs: 60000,
        jitterFactor: 0.1,
      },
    },
    ghCli: {
      path: "gh",
      timeout: 30000,
      retry: {
        maxRetries: 3,
        initialDelayMs: 2000,
        maxDelayMs: 30000,
        jitterFactor: 0.1,
      },
    },
    test: "npm test",
    lint: "npm run lint",
    build: "npm run build",
    typecheck: "npm run typecheck",
    preInstall: "",
    claudeMdPath: "CLAUDE.md",
    skillsPath: ".claude/skills",
  },
  review: {
    enabled: true,
    rounds: [
      {
        name: "code-review",
        promptTemplate:
          "Review the following code changes for correctness, style, and potential issues:\n\n{diff}",
        failAction: "warn",
        maxRetries: 2,
        model: null,
        blind: true,
        adversarial: true,
      },
    ],
    simplify: {
      enabled: true,
      promptTemplate:
        "Simplify the following implementation while preserving all functionality:\n\n{diff}",
    },
    unifiedMode: false,  // 기본값은 false로 기존 동작 유지
  },
  pr: {
    targetBranch: "main",
    draft: true,
    titleTemplate: "[AQ-#{{issueNumber}}] {{title}}",
    bodyTemplate:
      "## Summary\n\n{summary}\n\nCloses #{issueNumber}",
    labels: [],
    assignees: [],
    reviewers: [],
    linkIssue: true,
    autoMerge: false,
    mergeMethod: "squash",
  },
  safety: {
    sensitivePaths: [
      ".env",
      ".env.*",
      "*.pem",
      "*.key",
      "secrets/**",
      "credentials/**",
    ],
    maxPhases: 10,
    maxRetries: 3,
    maxTotalDurationMs: 3600000,
    maxFileChanges: 50,
    maxInsertions: 2000,
    maxDeletions: 1000,
    requireTests: false,
    blockDirectBasePush: true,
    timeouts: {
      planGeneration: 120000,
      phaseImplementation: 600000,
      reviewRound: 180000,
      prCreation: 60000,
    },
    stopConditions: ["STOP", "ABORT", "SAFETY_VIOLATION"],
    allowedLabels: [],
    rollbackStrategy: "failed-only",
    feasibilityCheck: {
      enabled: true,
      maxRequirements: 5,
      maxFiles: 4,
      blockedKeywords: [
        "architecture",
        "refactor",
        "migration",
        "breaking change",
        "major rewrite"
      ],
      skipReasons: [
        "Too many requirements (>5)",
        "Too many files affected (>4)",
        "Architecture change detected",
        "Blocked keyword found"
      ],
    },
  },
  executionMode: "standard",
  hooks: {
    // No hooks configured by default - users can add them in config.yml
  },
};
