import { describe, it, expect } from "vitest";
import { dispatchEvent } from "../../src/server/event-dispatcher.js";

const makePayload = (action: string, labels: string[]) => ({
  action,
  issue: {
    number: 42,
    title: "Test",
    body: "Body",
    labels: labels.map(name => ({ name })),
    user: { login: "user" },
  },
  repository: {
    full_name: "test/repo",
    default_branch: "main",
  },
});

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
});
