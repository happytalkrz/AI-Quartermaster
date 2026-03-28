import { describe, it, expect } from "vitest";
import { classifyError } from "../../src/pipeline/error-classifier.js";

describe("classifyError", () => {
  describe("TS_ERROR", () => {
    it("detects TS2xxx error codes", () => {
      expect(classifyError("error TS2345: Argument of type 'string' is not assignable")).toBe("TS_ERROR");
    });

    it("detects TS1xxx error codes", () => {
      expect(classifyError("error TS1005: ';' expected")).toBe("TS_ERROR");
    });

    it("detects 'type error' phrase", () => {
      expect(classifyError("Type error: Cannot assign to read only property")).toBe("TS_ERROR");
    });

    it("detects 'cannot find name'", () => {
      expect(classifyError("Cannot find name 'myVar'")).toBe("TS_ERROR");
    });

    it("detects 'property does not exist'", () => {
      expect(classifyError("Property 'foo' does not exist on type 'Bar'")).toBe("TS_ERROR");
    });

    it("is case-insensitive", () => {
      expect(classifyError("ERROR TS2304: Cannot find name 'X'")).toBe("TS_ERROR");
    });
  });

  describe("TIMEOUT", () => {
    it("detects 'timeout'", () => {
      expect(classifyError("Operation timeout after 30s")).toBe("TIMEOUT");
    });

    it("detects 'timed out'", () => {
      expect(classifyError("Process timed out")).toBe("TIMEOUT");
    });

    it("detects 'SIGTERM'", () => {
      expect(classifyError("Process killed with SIGTERM")).toBe("TIMEOUT");
    });

    it("is case-insensitive", () => {
      expect(classifyError("TIMEOUT exceeded")).toBe("TIMEOUT");
    });
  });

  describe("CLI_CRASH", () => {
    it("detects 'ENOENT'", () => {
      expect(classifyError("ENOENT: no such file or directory")).toBe("CLI_CRASH");
    });

    it("detects 'spawn' error", () => {
      expect(classifyError("spawn git ENOENT")).toBe("CLI_CRASH");
    });

    it("detects 'cli_crash'", () => {
      expect(classifyError("CLI_CRASH: runner failed")).toBe("CLI_CRASH");
    });

    it("detects 'exited with code'", () => {
      expect(classifyError("Process exited with code 127")).toBe("CLI_CRASH");
    });
  });

  describe("VERIFICATION_FAILED", () => {
    it("detects 'tests failed'", () => {
      expect(classifyError("Tests failed: 3 failing")).toBe("VERIFICATION_FAILED");
    });

    it("detects 'lint'", () => {
      expect(classifyError("lint error in src/index.ts")).toBe("VERIFICATION_FAILED");
    });

    it("detects 'verification'", () => {
      expect(classifyError("Verification step failed")).toBe("VERIFICATION_FAILED");
    });
  });

  describe("SAFETY_VIOLATION", () => {
    it("detects 'safety'", () => {
      expect(classifyError("Safety check failed")).toBe("SAFETY_VIOLATION");
    });

    it("detects 'sensitive'", () => {
      expect(classifyError("Attempted to modify sensitive path")).toBe("SAFETY_VIOLATION");
    });

    it("detects 'violation'", () => {
      expect(classifyError("Policy violation detected")).toBe("SAFETY_VIOLATION");
    });
  });

  describe("UNKNOWN", () => {
    it("returns UNKNOWN for unrecognized error messages", () => {
      expect(classifyError("Something went wrong")).toBe("UNKNOWN");
    });

    it("returns UNKNOWN for empty string", () => {
      expect(classifyError("")).toBe("UNKNOWN");
    });

    it("returns UNKNOWN for generic messages with no keywords", () => {
      expect(classifyError("Unexpected failure in pipeline stage")).toBe("UNKNOWN");
    });
  });
});
