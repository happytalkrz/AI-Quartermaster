import { describe, it, expect, vi } from "vitest";
import { dispatchEvent } from "../../src/server/event-dispatcher.js";
import type { AQConfig } from "../../src/types/config.js";
import type { JobStore } from "../../src/queue/job-store.js";
import type { Job } from "../../src/types/pipeline.js";
import { checkDependencyPRsMerged } from "../../src/queue/dependency-resolver.js";

vi.mock("../../src/queue/dependency-resolver.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    checkDependencyPRsMerged: vi.fn(),
  };
});

const makePayload = (action: string, labels: string[], author = "user") => ({
  action,
  issue: {
    number: 42,
    title: "Test",
    body: "Body",
    labels: labels.map(name => ({ name })),
    user: { login: author },
  },
  repository: {
    full_name: "test/repo",
    default_branch: "main",
  },
});

const makeConfig = (instanceOwners: string[]): AQConfig => ({
  general: { instanceOwners },
  git: { allowedRepos: ["test/repo"] },
  projects: [],
} as unknown as AQConfig);

describe("dispatchEvent", () => {
  it("should process issues.labeled with matching label", async () => {
    const result = await dispatchEvent("issues", makePayload("labeled", ["aqm"]), ["aqm"]);
    expect(result.shouldProcess).toBe(true);
    expect(result.issueNumber).toBe(42);
    expect(result.repo).toBe("test/repo");
  });

  it("should ignore non-issues events", async () => {
    const result = await dispatchEvent("push", makePayload("labeled", ["aqm"]), ["aqm"]);
    expect(result.shouldProcess).toBe(false);
  });

  it("should ignore non-labeled actions", async () => {
    const result = await dispatchEvent("issues", makePayload("opened", ["aqm"]), ["aqm"]);
    expect(result.shouldProcess).toBe(false);
  });

  it("should ignore when no matching label", async () => {
    const result = await dispatchEvent("issues", makePayload("labeled", ["bug"]), ["aqm"]);
    expect(result.shouldProcess).toBe(false);
  });

  it("should process when triggerLabels is empty (allow all)", async () => {
    const result = await dispatchEvent("issues", makePayload("labeled", ["anything"]), []);
    expect(result.shouldProcess).toBe(true);
  });

  describe("owner filtering", () => {
    it("should block when instanceOwners is empty (not configured)", async () => {
      const config = makeConfig([]);
      const result = await dispatchEvent("issues", makePayload("labeled", ["ai-quartermaster"], "anyone"), ["ai-quartermaster"], config);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toMatch(/instanceOwners/);
    });

    it("should process when author is in instanceOwners", async () => {
      const config = makeConfig(["alice", "bob"]);
      const result = await dispatchEvent("issues", makePayload("labeled", ["ai-quartermaster"], "alice"), ["ai-quartermaster"], config);
      expect(result.shouldProcess).toBe(true);
    });

    it("should reject when author is not in instanceOwners", async () => {
      const config = makeConfig(["alice", "bob"]);
      const result = await dispatchEvent("issues", makePayload("labeled", ["ai-quartermaster"], "charlie"), ["ai-quartermaster"], config);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toContain("charlie");
      expect(result.reason).toContain("instanceOwners");
    });

    it("should reject before repo check when owner is not allowed", async () => {
      const config = makeConfig(["alice"]);
      // charlie is not in instanceOwners — should fail on owner check
      const result = await dispatchEvent("issues", makePayload("labeled", ["ai-quartermaster"], "charlie"), ["ai-quartermaster"], config);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toMatch(/instanceOwners/);
    });
  });

  describe("active job deduplication", () => {
    const makeStore = (job: Partial<Job> | undefined): Pick<JobStore, "findAnyByIssue"> => ({
      findAnyByIssue: () => job as Job | undefined,
    });

    it("should block dispatch when queued job already exists", async () => {
      const store = makeStore({ id: "aq-42-1", status: "queued", issueNumber: 42, repo: "test/repo" });
      const result = await dispatchEvent("issues", makePayload("labeled", ["aqm"]), ["aqm"], undefined, store as unknown as JobStore);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toMatch(/queued/);
    });

    it("should block dispatch when running job already exists", async () => {
      const store = makeStore({ id: "aq-42-2", status: "running", issueNumber: 42, repo: "test/repo" });
      const result = await dispatchEvent("issues", makePayload("labeled", ["aqm"]), ["aqm"], undefined, store as unknown as JobStore);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toMatch(/running/);
    });

    it("should allow dispatch when only a success job exists", async () => {
      const store = makeStore({ id: "aq-42-3", status: "success", issueNumber: 42, repo: "test/repo" });
      const result = await dispatchEvent("issues", makePayload("labeled", ["aqm"]), ["aqm"], undefined, store as unknown as JobStore);
      expect(result.shouldProcess).toBe(true);
    });

    it("should allow dispatch when no existing job", async () => {
      const store = makeStore(undefined);
      const result = await dispatchEvent("issues", makePayload("labeled", ["aqm"]), ["aqm"], undefined, store as unknown as JobStore);
      expect(result.shouldProcess).toBe(true);
    });
  });

  describe("dependency PR merge gate", () => {
    const makeDepsConfig = (): AQConfig => ({
      general: { instanceOwners: ["user"] },
      git: { allowedRepos: ["test/repo"] },
      commands: { ghCli: { path: "gh" } },
      projects: [],
    } as unknown as AQConfig);

    const makePayloadWithDeps = (depNumbers: number[]) => ({
      action: "labeled",
      issue: {
        number: 42,
        title: "Test",
        body: `depends: ${depNumbers.map(n => `#${n}`).join(", ")}`,
        labels: [{ name: "aqm" }],
        user: { login: "user" },
      },
      repository: {
        full_name: "test/repo",
        default_branch: "main",
      },
    });

    it("의존 PR 미머지 → shouldProcess: false, reasonCode: dependency_pr_not_merged", async () => {
      vi.mocked(checkDependencyPRsMerged).mockResolvedValueOnce({
        merged: false,
        unmerged: [100],
        notFound: [],
      });

      const result = await dispatchEvent(
        "issues",
        makePayloadWithDeps([100]),
        ["aqm"],
        makeDepsConfig()
      );

      expect(result.shouldProcess).toBe(false);
      expect(result.reasonCode).toBe("dependency_pr_not_merged");
    });

    it("의존 PR 머지됨 → shouldProcess: true", async () => {
      vi.mocked(checkDependencyPRsMerged).mockResolvedValueOnce({
        merged: true,
        unmerged: [],
        notFound: [],
      });

      const result = await dispatchEvent(
        "issues",
        makePayloadWithDeps([100]),
        ["aqm"],
        makeDepsConfig()
      );

      expect(result.shouldProcess).toBe(true);
    });
  });
});
