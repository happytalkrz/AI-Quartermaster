import { vi } from "vitest";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import type { AQConfig } from "../../../src/types/config.js";
import type { Plan, PhaseResult } from "../../../src/types/pipeline.js";

// Test constants to avoid magic numbers
const TEST_CONSTANTS = {
  ISSUE_NUMBER: 42,
  PR_NUMBER: 1,
  BASE_DURATION: 1000,
  DURATION_INCREMENT: 200,
  TEMP_PROJECT_ROOT: "/tmp/project",
  TEST_REPO: "test/repo",
  WORKTREE_PATH: "/tmp/wt/42-fix-bug",
  WORK_BRANCH: "aq/42-fix-bug",
} as const;

// ---------------------------------------------------------------------------
// Config Helpers
// ---------------------------------------------------------------------------

/**
 * Deep merge utility for config objects
 */
function mergeDeep<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = structuredClone(target);

  for (const key in source) {
    const sourceValue = source[key];
    if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
      result[key] = mergeDeep(result[key] || {} as Record<string, unknown>, sourceValue);
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue;
    }
  }

  return result;
}

/**
 * Create a test config with sensible defaults and optional overrides
 */
export function makeConfig(overrides: Partial<AQConfig> = {}): AQConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.general.projectName = "test";
  config.general.targetRoot = TEST_CONSTANTS.TEMP_PROJECT_ROOT;
  config.git.allowedRepos = [TEST_CONSTANTS.TEST_REPO];
  // Deep merge overrides to handle nested config properties correctly
  return mergeDeep(config, overrides);
}

// ---------------------------------------------------------------------------
// Plan Helpers
// ---------------------------------------------------------------------------

/**
 * Create a test work plan with specified number of phases
 */
export function makePlan(phaseCount: number): Plan {
  return {
    issueNumber: TEST_CONSTANTS.ISSUE_NUMBER,
    title: "Fix bug",
    problemDefinition: "There is a bug",
    requirements: ["Fix it"],
    affectedFiles: ["src/index.ts"],
    risks: [],
    phases: Array.from({ length: phaseCount }, (_, i) => ({
      index: i,
      name: `Phase ${i + 1}`,
      description: `Do thing ${i + 1}`,
      targetFiles: [`src/file${i}.ts`],
      commitStrategy: "atomic",
      verificationCriteria: ["tests pass"],
    })),
    verificationPoints: ["all tests pass"],
    stopConditions: [],
  };
}

/**
 * Create a test phase result with customizable properties
 */
export function makePhaseResult(
  index: number,
  name: string,
  success: boolean,
  extra: Partial<PhaseResult> = {}
): PhaseResult {
  return {
    phaseIndex: index,
    phaseName: name,
    success,
    commitHash: success ? `abc${index}1234` : undefined,
    durationMs: TEST_CONSTANTS.BASE_DURATION + index * TEST_CONSTANTS.DURATION_INCREMENT,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Mock Setup Helpers
// ---------------------------------------------------------------------------

type MockSet = {
  fetchIssue: vi.Mock;
  syncBaseBranch: vi.Mock;
  createWorkBranch: vi.Mock;
  createWorktree: vi.Mock;
  installDependencies: vi.Mock;
  runCli: vi.Mock;
  runCoreLoop: vi.Mock;
  pushBranch: vi.Mock;
  checkConflicts: vi.Mock;
  attemptRebase: vi.Mock;
  enableAutoMerge: vi.Mock;
  addIssueComment: vi.Mock;
  createDraftPR: vi.Mock;
  removeWorktree: vi.Mock;
  getDiffContent: vi.Mock;
  runReviews: vi.Mock;
  runSimplify: vi.Mock;
  runFinalValidation: vi.Mock;
  validateIssue: vi.Mock;
  validatePlan: vi.Mock;
  validateBeforePush: vi.Mock;
  closeIssue: ReturnType<typeof vi.mocked>;
};

/**
 * Setup standard success mocks for pipeline integration tests
 */
export function setupSuccessMocks(phaseCount = 2, mocks: MockSet): void {
  const plan = makePlan(phaseCount);

  mocks.fetchIssue.mockResolvedValue({
    number: TEST_CONSTANTS.ISSUE_NUMBER,
    title: "Fix bug",
    body: "Fix the bug",
    labels: [],
  });
  mocks.syncBaseBranch.mockResolvedValue(undefined);
  mocks.createWorkBranch.mockResolvedValue({
    baseBranch: "master",
    workBranch: TEST_CONSTANTS.WORK_BRANCH,
  });
  mocks.createWorktree.mockResolvedValue({
    path: TEST_CONSTANTS.WORKTREE_PATH,
    branch: TEST_CONSTANTS.WORK_BRANCH,
  });
  mocks.installDependencies.mockResolvedValue(undefined);
  mocks.runCli.mockResolvedValue({
    stdout: "src/\n",
    stderr: "",
    exitCode: 0,
  });
  mocks.runCoreLoop.mockResolvedValue({
    plan,
    phaseResults: plan.phases.map(p => makePhaseResult(p.index, p.name, true)),
    success: true,
  });
  mocks.pushBranch.mockResolvedValue(undefined);
  mocks.checkConflicts.mockResolvedValue({
    hasConflicts: false,
    conflictFiles: [],
  });
  mocks.attemptRebase.mockResolvedValue({ success: true });
  mocks.enableAutoMerge.mockResolvedValue(true);
  mocks.addIssueComment.mockResolvedValue(true);
  mocks.closeIssue.mockResolvedValue(true);
  mocks.createDraftPR.mockResolvedValue({
    url: `https://github.com/${TEST_CONSTANTS.TEST_REPO}/pull/${TEST_CONSTANTS.PR_NUMBER}`,
    number: TEST_CONSTANTS.PR_NUMBER,
  });
  mocks.removeWorktree.mockResolvedValue(undefined);
  mocks.getDiffContent.mockResolvedValue(
    "diff --git a/src/index.ts b/src/index.ts\n+fixed line"
  );
  mocks.runReviews.mockResolvedValue({
    rounds: [],
    allPassed: true,
  });
  mocks.runSimplify.mockResolvedValue({
    applied: false,
    linesRemoved: 0,
    linesAdded: 0,
    filesModified: [],
    testsPassed: true,
    rolledBack: false,
    summary: "No changes",
  });
  mocks.runFinalValidation.mockResolvedValue({
    success: true,
    checks: [
      { name: "typecheck", passed: true },
      { name: "test", passed: true },
    ],
  });
  mocks.validateIssue.mockReturnValue(undefined);
  mocks.validatePlan.mockReturnValue(undefined);
  mocks.validateBeforePush.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Fixture Helpers
// ---------------------------------------------------------------------------

/**
 * Create default mocks for all pipeline dependencies
 */
export function createDefaultMocks(): MockSet {
  return {
    fetchIssue: vi.fn(),
    syncBaseBranch: vi.fn(),
    createWorkBranch: vi.fn(),
    createWorktree: vi.fn(),
    installDependencies: vi.fn(),
    runCli: vi.fn(),
    runCoreLoop: vi.fn(),
    pushBranch: vi.fn(),
    checkConflicts: vi.fn(),
    attemptRebase: vi.fn(),
    enableAutoMerge: vi.fn(),
    addIssueComment: vi.fn(),
    createDraftPR: vi.fn(),
    removeWorktree: vi.fn(),
    getDiffContent: vi.fn(),
    runReviews: vi.fn(),
    runSimplify: vi.fn(),
    runFinalValidation: vi.fn(),
    validateIssue: vi.fn(),
    validatePlan: vi.fn(),
    validateBeforePush: vi.fn(),
    closeIssue: vi.fn() as ReturnType<typeof vi.mocked>,
  };
}

/**
 * Get the path to the minimal project fixture
 */
export function getFixtureProjectPath(): string {
  return `${process.cwd()}/tests/fixtures/minimal-project`;
}
