import { describe, it, expect } from "vitest";
import { EnvSource } from "../../../src/config/sources/env-source.js";

describe("EnvSource", () => {
  it("should have name 'env'", () => {
    const source = new EnvSource({});
    expect(source.name).toBe("env");
  });

  it("should return empty object for empty env", () => {
    const source = new EnvSource({});
    expect(source.load()).toEqual({});
  });

  it("should parse AQM_GENERAL_LOG_LEVEL into general.logLevel", () => {
    const source = new EnvSource({ AQM_GENERAL_LOG_LEVEL: "debug" });
    const result = source.load();
    expect(result).toHaveProperty("general.logLevel", "debug");
  });

  it("should parse numeric values", () => {
    const source = new EnvSource({ AQM_GENERAL_CONCURRENCY: "3" });
    const result = source.load();
    expect(result).toHaveProperty("general.concurrency", 3);
  });

  it("should parse boolean values", () => {
    const source = new EnvSource({ AQM_GENERAL_DRY_RUN: "true" });
    const result = source.load();
    expect(result).toHaveProperty("general.dryRun", true);
  });

  it("should parse comma-separated values as arrays", () => {
    const source = new EnvSource({ AQM_GIT_ALLOWED_REPOS: "owner/repo1,owner/repo2" });
    const result = source.load();
    expect(result).toHaveProperty("git.allowedRepos", ["owner/repo1", "owner/repo2"]);
  });

  it("should ignore non-AQM_ prefixed variables", () => {
    const source = new EnvSource({ NODE_ENV: "test", PATH: "/usr/bin" });
    expect(source.load()).toEqual({});
  });

  it("should ignore AQM_ variables without a section_key structure", () => {
    const source = new EnvSource({ AQM_NOKEY: "value" });
    expect(source.load()).toEqual({});
  });

  it("should use process.env when no env is passed", () => {
    // Just verify it doesn't throw and returns an object
    const source = new EnvSource();
    expect(typeof source.load()).toBe("object");
  });
});
