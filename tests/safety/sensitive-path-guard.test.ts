import { describe, it, expect } from "vitest";
import { checkSensitivePaths } from "../../src/safety/sensitive-path-guard.js";

describe("checkSensitivePaths", () => {
  const patterns = [".env*", "**/*.pem", "**/secrets/**", ".github/workflows/**"];

  it("should pass when no sensitive files are changed", () => {
    expect(() => checkSensitivePaths(["src/app.ts", "tests/app.test.ts"], patterns)).not.toThrow();
  });

  it("should throw on .env file", () => {
    expect(() => checkSensitivePaths([".env.local"], patterns)).toThrow("SensitivePathGuard");
  });

  it("should throw on .pem file", () => {
    expect(() => checkSensitivePaths(["certs/server.pem"], patterns)).toThrow("SensitivePathGuard");
  });

  it("should throw on secrets directory", () => {
    expect(() => checkSensitivePaths(["config/secrets/api-key.json"], patterns)).toThrow("SensitivePathGuard");
  });

  it("should throw on GitHub workflows", () => {
    expect(() => checkSensitivePaths([".github/workflows/deploy.yml"], patterns)).toThrow("SensitivePathGuard");
  });

  it("should list all violations in error", () => {
    try {
      checkSensitivePaths([".env", "key.pem"], [".env*", "**/*.pem"]);
    } catch (e: any) {
      expect(e.details.violations).toHaveLength(2);
    }
  });
});
