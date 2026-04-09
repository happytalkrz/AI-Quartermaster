import { describe, it, expect } from "vitest";
import { checkPathAgainstRules, checkPathsAgainstRules } from "../../src/safety/rule-engine.js";
import { SafetyViolationError } from "../../src/types/errors.js";
import type { RuleSet } from "../../src/safety/rule-engine.js";

describe("checkPathAgainstRules", () => {
  describe("deny-first (default)", () => {
    const rules: RuleSet = {
      allow: [],
      deny: ["**/.env*", "**/secrets/**"],
    };

    it("should pass for non-matching path", () => {
      expect(() => checkPathAgainstRules("src/app.ts", rules)).not.toThrow();
    });

    it("should throw for denied path", () => {
      expect(() => checkPathAgainstRules(".env.local", rules)).toThrow(SafetyViolationError);
    });

    it("should throw for denied nested path", () => {
      expect(() => checkPathAgainstRules("config/secrets/key.json", rules)).toThrow(SafetyViolationError);
    });

    it("should allow override: allow pattern exempts denied path", () => {
      const overrideRules: RuleSet = {
        allow: ["config/secrets/allowed.json"],
        deny: ["**/secrets/**"],
      };
      expect(() => checkPathAgainstRules("config/secrets/allowed.json", overrideRules)).not.toThrow();
    });

    it("error details contain path and matchedDenyPattern", () => {
      try {
        checkPathAgainstRules(".env", rules);
        expect.fail("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(SafetyViolationError);
        if (err instanceof SafetyViolationError) {
          expect(err.details?.path).toBe(".env");
          expect(err.details?.matchedDenyPattern).toBe("**/.env*");
        }
      }
    });
  });

  describe("allow-first strategy", () => {
    const rules: RuleSet = {
      allow: ["src/**"],
      deny: ["**/*.secret.ts"],
      strategy: "allow-first",
    };

    it("should pass for allowed path even if deny pattern could match", () => {
      // src/** matches → allowed regardless of deny
      expect(() => checkPathAgainstRules("src/utils.ts", rules)).not.toThrow();
    });

    it("should pass for path not in allow and not in deny", () => {
      expect(() => checkPathAgainstRules("README.md", rules)).not.toThrow();
    });

    it("should throw for path not in allow but in deny", () => {
      expect(() => checkPathAgainstRules("config/db.secret.ts", rules)).toThrow(SafetyViolationError);
    });

    it("should pass for empty allow/deny", () => {
      const emptyRules: RuleSet = { allow: [], deny: [], strategy: "allow-first" };
      expect(() => checkPathAgainstRules("anything.ts", emptyRules)).not.toThrow();
    });
  });
});

describe("checkPathsAgainstRules", () => {
  const rules: RuleSet = {
    allow: [],
    deny: ["**/.env*", "**/secrets/**"],
  };

  it("should pass when no paths violate rules", () => {
    expect(() => checkPathsAgainstRules(["src/app.ts", "tests/app.test.ts"], rules)).not.toThrow();
  });

  it("should throw when one path violates", () => {
    expect(() => checkPathsAgainstRules(["src/app.ts", ".env.local"], rules)).toThrow(SafetyViolationError);
  });

  it("should collect all violations in single error", () => {
    try {
      checkPathsAgainstRules([".env", "config/secrets/key.json", "src/ok.ts"], rules);
      expect.fail("should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(SafetyViolationError);
      if (err instanceof SafetyViolationError) {
        const violations = err.details?.violations as string[];
        expect(violations).toHaveLength(2);
      }
    }
  });

  it("should pass on empty paths array", () => {
    expect(() => checkPathsAgainstRules([], rules)).not.toThrow();
  });
});
