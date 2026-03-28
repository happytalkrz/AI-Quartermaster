import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/prompt/template-renderer.js";

describe("renderTemplate", () => {
  it("should replace simple variables", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("should replace nested variables", () => {
    const result = renderTemplate("Issue #{{issue.number}}: {{issue.title}}", {
      issue: { number: "42", title: "Fix bug" },
    });
    expect(result).toBe("Issue #42: Fix bug");
  });

  it("should handle arrays", () => {
    const result = renderTemplate("Labels: {{labels}}", {
      labels: ["bug", "enhancement"],
    });
    expect(result).toBe("Labels: bug, enhancement");
  });

  it("should handle spaces in template tags", () => {
    const result = renderTemplate("{{ name }}", { name: "test" });
    expect(result).toBe("test");
  });

  it("should leave unresolved variables as-is", () => {
    const result = renderTemplate("{{unknown}}", {});
    expect(result).toBe("{{unknown}}");
  });

  it("should handle numbers and booleans", () => {
    const result = renderTemplate("{{count}} items, active: {{active}}", {
      count: 5,
      active: true,
    });
    expect(result).toBe("5 items, active: true");
  });

  it("should handle deeply nested variables", () => {
    const result = renderTemplate("{{a.b.c}}", {
      a: { b: { c: "deep" } },
    });
    expect(result).toBe("deep");
  });
});
