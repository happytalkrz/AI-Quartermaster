import { describe, it, expect } from "vitest";
import { dispatchEvent } from "../../src/server/event-dispatcher.js";
import type { AQConfig } from "../../src/types/config.js";

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
  it("should process issues.labeled with matching label", () => {
    const result = dispatchEvent("issues", makePayload("labeled", ["aqm"]), ["aqm"]);
    expect(result.shouldProcess).toBe(true);
    expect(result.issueNumber).toBe(42);
    expect(result.repo).toBe("test/repo");
  });

  it("should ignore non-issues events", () => {
    const result = dispatchEvent("push", makePayload("labeled", ["aqm"]), ["aqm"]);
    expect(result.shouldProcess).toBe(false);
  });

  it("should ignore non-labeled actions", () => {
    const result = dispatchEvent("issues", makePayload("opened", ["aqm"]), ["aqm"]);
    expect(result.shouldProcess).toBe(false);
  });

  it("should ignore when no matching label", () => {
    const result = dispatchEvent("issues", makePayload("labeled", ["bug"]), ["aqm"]);
    expect(result.shouldProcess).toBe(false);
  });

  it("should process when triggerLabels is empty (allow all)", () => {
    const result = dispatchEvent("issues", makePayload("labeled", ["anything"]), []);
    expect(result.shouldProcess).toBe(true);
  });

  describe("owner filtering", () => {
    it("should block when instanceOwners is empty (not configured)", () => {
      const config = makeConfig([]);
      const result = dispatchEvent("issues", makePayload("labeled", ["ai-quartermaster"], "anyone"), ["ai-quartermaster"], config);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toMatch(/instanceOwners/);
    });

    it("should process when author is in instanceOwners", () => {
      const config = makeConfig(["alice", "bob"]);
      const result = dispatchEvent("issues", makePayload("labeled", ["ai-quartermaster"], "alice"), ["ai-quartermaster"], config);
      expect(result.shouldProcess).toBe(true);
    });

    it("should reject when author is not in instanceOwners", () => {
      const config = makeConfig(["alice", "bob"]);
      const result = dispatchEvent("issues", makePayload("labeled", ["ai-quartermaster"], "charlie"), ["ai-quartermaster"], config);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toContain("charlie");
      expect(result.reason).toContain("instanceOwners");
    });

    it("should reject before repo check when owner is not allowed", () => {
      const config = makeConfig(["alice"]);
      // charlie is not in instanceOwners — should fail on owner check
      const result = dispatchEvent("issues", makePayload("labeled", ["ai-quartermaster"], "charlie"), ["ai-quartermaster"], config);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toMatch(/instanceOwners/);
    });
  });
});
