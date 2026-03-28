import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseDependencies,
  checkCircularDependency,
  areDependenciesMet,
} from "../../src/queue/dependency-resolver.js";
import { JobStore } from "../../src/queue/job-store.js";

// ─── parseDependencies ───────────────────────────────────────────────────────

describe("parseDependencies", () => {
  it("returns empty array for empty body", () => {
    expect(parseDependencies("")).toEqual([]);
  });

  it("returns empty array for body with no depends", () => {
    expect(parseDependencies("This is a normal issue body.")).toEqual([]);
  });

  it("parses single dependency: depends: #11", () => {
    expect(parseDependencies("depends: #11")).toEqual([11]);
  });

  it("parses multiple dependencies: depends: #11, #12", () => {
    expect(parseDependencies("depends: #11, #12")).toEqual([11, 12]);
  });

  it("parses 'depends on #11' variant", () => {
    expect(parseDependencies("depends on #11")).toEqual([11]);
  });

  it("parses 'depends on: #11' variant", () => {
    expect(parseDependencies("depends on: #11")).toEqual([11]);
  });

  it("is case-insensitive", () => {
    expect(parseDependencies("Depends: #5")).toEqual([5]);
    expect(parseDependencies("DEPENDS ON #3")).toEqual([3]);
  });

  it("deduplicates repeated issue numbers", () => {
    expect(parseDependencies("depends: #11, #11, #12")).toEqual([11, 12]);
  });

  it("handles inline depends in longer body", () => {
    const body = "## Description\nThis task depends: #7, #8\nSome more text.";
    expect(parseDependencies(body)).toEqual([7, 8]);
  });
});

// ─── checkCircularDependency ──────────────────────────────────────────────────

describe("checkCircularDependency", () => {
  let dataDir: string;
  let store: JobStore;

  beforeEach(() => {
    dataDir = join(tmpdir(), `aq-dep-test-${Date.now()}`);
    mkdirSync(dataDir, { recursive: true });
    store = new JobStore(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns false when there are no existing jobs", () => {
    expect(checkCircularDependency(10, [11], store)).toBe(false);
  });

  it("returns false for non-circular chain: 10 depends on 11, 11 depends on 12", () => {
    // Create job for issue 11 that depends on 12
    const j11 = store.create(11, "test/repo", [12]);
    store.update(j11.id, { dependencies: [12] });
    expect(checkCircularDependency(10, [11], store)).toBe(false);
  });

  it("detects direct cycle: issue 11 depends on 10, adding 10 -> [11] would cycle", () => {
    // Job 11 depends on 10
    const j11 = store.create(11, "test/repo", [10]);
    store.update(j11.id, { dependencies: [10] });
    // Now we want to add issue 10 with dependency on 11 → cycle
    expect(checkCircularDependency(10, [11], store)).toBe(true);
  });

  it("detects transitive cycle: 12->11->10, adding 10->[12] would cycle", () => {
    const j11 = store.create(11, "test/repo", [10]);
    store.update(j11.id, { dependencies: [10] });
    const j12 = store.create(12, "test/repo", [11]);
    store.update(j12.id, { dependencies: [11] });
    // Issue 10 wants to depend on 12, but 12->11->10 creates cycle
    expect(checkCircularDependency(10, [12], store)).toBe(true);
  });

  it("returns false for empty dependencies list", () => {
    expect(checkCircularDependency(10, [], store)).toBe(false);
  });
});

// ─── areDependenciesMet ───────────────────────────────────────────────────────

describe("areDependenciesMet", () => {
  let dataDir: string;
  let store: JobStore;

  beforeEach(() => {
    dataDir = join(tmpdir(), `aq-depmet-test-${Date.now()}`);
    mkdirSync(dataDir, { recursive: true });
    store = new JobStore(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns met: true for empty dependencies", () => {
    const result = areDependenciesMet([], "test/repo", store);
    expect(result).toEqual({ met: true, pending: [] });
  });

  it("returns met: false when dependency job does not exist", () => {
    const result = areDependenciesMet([11], "test/repo", store);
    expect(result.met).toBe(false);
    expect(result.pending).toContain(11);
  });

  it("returns met: false when dependency job is queued (not success)", () => {
    store.create(11, "test/repo"); // status: queued
    const result = areDependenciesMet([11], "test/repo", store);
    expect(result.met).toBe(false);
    expect(result.pending).toContain(11);
  });

  it("returns met: true when dependency job has succeeded", () => {
    const job = store.create(11, "test/repo");
    store.update(job.id, { status: "success", completedAt: new Date().toISOString() });
    const result = areDependenciesMet([11], "test/repo", store);
    expect(result).toEqual({ met: true, pending: [] });
  });

  it("returns met: false with correct pending list when some deps unmet", () => {
    const job11 = store.create(11, "test/repo");
    store.update(job11.id, { status: "success", completedAt: new Date().toISOString() });
    // issue 12 still queued
    store.create(12, "test/repo");
    const result = areDependenciesMet([11, 12], "test/repo", store);
    expect(result.met).toBe(false);
    expect(result.pending).toEqual([12]);
  });

  it("respects repo boundary — success in different repo does not count", () => {
    const job = store.create(11, "other/repo");
    store.update(job.id, { status: "success", completedAt: new Date().toISOString() });
    const result = areDependenciesMet([11], "test/repo", store);
    expect(result.met).toBe(false);
  });
});
