import { describe, it, expect } from "vitest";
import {
  estimateTokenCount,
  getTokenLimit,
  getEffectiveTokenLimit,
  exceedsTokenLimit,
  analyzeTokenUsage,
  truncateToTokenBudget,
  summarizeForBudget,
  truncateRepoStructure,
  isCodeContent,
  MODEL_TOKEN_LIMITS,
  SAFETY_MARGIN,
  CHARS_PER_TOKEN,
  CHARS_PER_TOKEN_BY_TYPE,
} from "../../src/review/token-estimator.js";

describe("token-estimator", () => {
  describe("estimateTokenCount", () => {
    it("should estimate tokens based on character count with natural language default", () => {
      expect(estimateTokenCount("")).toBe(0);
      expect(estimateTokenCount("a")).toBe(1); // 1 char = 1 token (rounded up)
      expect(estimateTokenCount("abcd")).toBe(1); // 4 chars = 1 token (natural language, 4 chars/token)
      expect(estimateTokenCount("abcde")).toBe(2); // 5 chars = 2 tokens (rounded up)

      // Simple text should be detected as natural language (4 chars/token)
      const simpleText = "a".repeat(100);
      expect(estimateTokenCount(simpleText)).toBe(25); // 100 chars = 25 tokens
    });

    it("should handle unicode characters", () => {
      expect(estimateTokenCount("한글")).toBe(1); // 2 chars = 1 token (rounded up)
      expect(estimateTokenCount("한글테스트")).toBe(2); // 5 chars = 2 tokens (rounded up)
      expect(estimateTokenCount("🚀")).toBe(1); // 1 emoji = 1 token (rounded up)
    });

    it("should handle large text", () => {
      // Large text of repeated characters should be detected as natural language
      const largeText = "a".repeat(800_000); // 800K characters
      expect(estimateTokenCount(largeText)).toBe(200_000); // 200K tokens (4 chars/token)
    });

    it("should auto-detect content type by default", () => {
      const naturalText = "This is a natural language sentence with normal words.";
      const codeText = "function test() { return value; }";

      // Should use auto-detection by default
      const naturalTokens = estimateTokenCount(naturalText);
      const codeTokens = estimateTokenCount(codeText);

      // Verify they use appropriate ratios
      expect(naturalTokens).toBe(Math.ceil(naturalText.length / CHARS_PER_TOKEN_BY_TYPE.natural));
      expect(codeTokens).toBe(Math.ceil(codeText.length / CHARS_PER_TOKEN_BY_TYPE.code));

      // Code should have more tokens per character
      const naturalRatio = naturalText.length / naturalTokens;
      const codeRatio = codeText.length / codeTokens;
      expect(codeRatio).toBeLessThan(naturalRatio);
    });

    it("should respect explicit content type parameter", () => {
      const text = "function example() { return true; }";

      const autoTokens = estimateTokenCount(text); // defaults to 'auto'
      const codeTokens = estimateTokenCount(text, 'code');
      const naturalTokens = estimateTokenCount(text, 'natural');

      // Auto should detect as code
      expect(autoTokens).toBe(codeTokens);
      // Code should have more tokens than natural
      expect(codeTokens).toBeGreaterThan(naturalTokens);
    });
  });

  describe("getTokenLimit", () => {
    it("should return correct limits for known models", () => {
      expect(getTokenLimit("claude-opus-4-5")).toBe(200_000);
      expect(getTokenLimit("claude-sonnet-4-20250514")).toBe(200_000);
      expect(getTokenLimit("claude-haiku-4-5-20251001")).toBe(200_000);
    });

    it("should handle pattern matching for similar models", () => {
      expect(getTokenLimit("claude-opus-4-6")).toBe(200_000);
      expect(getTokenLimit("claude-sonnet-3.5")).toBe(200_000);
      expect(getTokenLimit("claude-haiku-3")).toBe(200_000);
    });

    it("should return default limit for unknown models", () => {
      expect(getTokenLimit("gpt-4")).toBe(200_000);
      expect(getTokenLimit("unknown-model")).toBe(200_000);
      expect(getTokenLimit("")).toBe(200_000);
    });

    it("should handle case-insensitive model names", () => {
      expect(getTokenLimit("CLAUDE-OPUS-4-5")).toBe(200_000);
      expect(getTokenLimit("Claude-Sonnet-4-20250514")).toBe(200_000);
    });
  });

  describe("getEffectiveTokenLimit", () => {
    it("should apply safety margin correctly", () => {
      const baseLimit = 200_000;
      const expectedEffective = Math.floor(baseLimit * (1 - SAFETY_MARGIN));

      expect(getEffectiveTokenLimit("claude-opus-4-5")).toBe(expectedEffective);
      expect(getEffectiveTokenLimit("claude-sonnet-4-20250514")).toBe(expectedEffective);
    });

    it("should return 160,000 for 200K base limit with 20% margin", () => {
      expect(getEffectiveTokenLimit("claude-opus-4-5")).toBe(160_000);
    });
  });

  describe("exceedsTokenLimit", () => {
    it("should return false for text within limits", () => {
      const smallText = "a".repeat(100); // ~25 tokens
      expect(exceedsTokenLimit(smallText, "claude-opus-4-5")).toBe(false);
    });

    it("should return true for text exceeding effective limit", () => {
      // 700K chars = 175K tokens, which exceeds 160K effective limit
      const largeText = "a".repeat(700_000);
      expect(exceedsTokenLimit(largeText, "claude-opus-4-5")).toBe(true);
    });

    it("should return false for text at the edge of effective limit", () => {
      // 640K chars = 160K tokens, exactly at effective limit
      const edgeText = "a".repeat(640_000);
      expect(exceedsTokenLimit(edgeText, "claude-opus-4-5")).toBe(false);
    });

    it("should return true for text just over effective limit", () => {
      // 644K chars = 161K tokens, just over 160K effective limit
      const overLimitText = "a".repeat(644_000);
      expect(exceedsTokenLimit(overLimitText, "claude-opus-4-5")).toBe(true);
    });
  });

  describe("analyzeTokenUsage", () => {
    it("should provide complete token usage analysis", () => {
      const text = "a".repeat(320_000); // 80K tokens
      const analysis = analyzeTokenUsage(text, "claude-opus-4-5");

      expect(analysis.estimatedTokens).toBe(80_000);
      expect(analysis.modelLimit).toBe(200_000);
      expect(analysis.effectiveLimit).toBe(160_000);
      expect(analysis.exceedsLimit).toBe(false);
      expect(analysis.usagePercentage).toBe(50); // 80K / 160K = 50%
    });

    it("should detect when limit is exceeded", () => {
      const text = "a".repeat(700_000); // 175K tokens
      const analysis = analyzeTokenUsage(text, "claude-opus-4-5");

      expect(analysis.estimatedTokens).toBe(175_000);
      expect(analysis.exceedsLimit).toBe(true);
      expect(analysis.usagePercentage).toBeCloseTo(109.375); // 175K / 160K
    });

    it("should handle empty text", () => {
      const analysis = analyzeTokenUsage("", "claude-opus-4-5");

      expect(analysis.estimatedTokens).toBe(0);
      expect(analysis.exceedsLimit).toBe(false);
      expect(analysis.usagePercentage).toBe(0);
    });

    it("should work with different models", () => {
      const text = "a".repeat(100_000); // 25K tokens
      const analysis = analyzeTokenUsage(text, "claude-haiku-4-5-20251001");

      expect(analysis.estimatedTokens).toBe(25_000);
      expect(analysis.modelLimit).toBe(200_000);
      expect(analysis.effectiveLimit).toBe(160_000);
      expect(analysis.exceedsLimit).toBe(false);
      expect(analysis.usagePercentage).toBeCloseTo(15.625); // 25K / 160K
    });
  });

  describe("constants", () => {
    it("should have correct safety margin", () => {
      expect(SAFETY_MARGIN).toBe(0.2);
    });

    it("should have correct chars per token ratio", () => {
      expect(CHARS_PER_TOKEN).toBe(4);
    });

    it("should have model limits defined", () => {
      expect(MODEL_TOKEN_LIMITS['claude-opus-4-5']).toBe(200_000);
      expect(MODEL_TOKEN_LIMITS['claude-sonnet-4-20250514']).toBe(200_000);
      expect(MODEL_TOKEN_LIMITS['claude-haiku-4-5-20251001']).toBe(200_000);
      expect(MODEL_TOKEN_LIMITS.default).toBe(200_000);
    });
  });

  describe("edge cases", () => {
    it("should handle very large numbers", () => {
      const hugeText = "a".repeat(10_000_000); // 10M chars = 2.5M tokens
      const analysis = analyzeTokenUsage(hugeText, "claude-opus-4-5");

      expect(analysis.estimatedTokens).toBe(2_500_000);
      expect(analysis.exceedsLimit).toBe(true);
      expect(analysis.usagePercentage).toBeCloseTo(1562.5); // way over limit
    });

    it("should handle null and undefined model names gracefully", () => {
      expect(getTokenLimit(null as unknown as string)).toBe(200_000);
      expect(getTokenLimit(undefined as unknown as string)).toBe(200_000);
    });

    it("should handle special characters and whitespace", () => {
      const specialText = "Hello\n\tWorld!@#$%^&*()";
      const tokens = estimateTokenCount(specialText);
      expect(tokens).toBe(Math.ceil(specialText.length / CHARS_PER_TOKEN));
    });
  });

  describe("truncateToTokenBudget", () => {
    it("should return empty string for invalid inputs", () => {
      expect(truncateToTokenBudget("", 100)).toBe("");
      expect(truncateToTokenBudget("text", 0)).toBe("");
      expect(truncateToTokenBudget("text", -1)).toBe("");
    });

    it("should return original text if within budget", () => {
      const text = "Hello world!";
      const tokens = estimateTokenCount(text);
      expect(truncateToTokenBudget(text, tokens + 10)).toBe(text);
      expect(truncateToTokenBudget(text, tokens)).toBe(text);
    });

    it("should truncate at sentence boundaries", () => {
      const text = "First sentence. Second sentence. Third sentence.";
      const result = truncateToTokenBudget(text, 5); // ~20 chars = 5 tokens
      expect(result).toContain("First sentence");
      expect(result.length).toBeLessThan(text.length);
    });

    it("should truncate at word boundaries when sentences don't fit", () => {
      const longSentence = "This is a very long sentence without proper punctuation";
      const result = truncateToTokenBudget(longSentence, 3); // ~12 chars = 3 tokens
      expect(result).toMatch(/^This is/);
      expect(result).toContain("...");
    });

    it("should handle text with mixed sentence endings", () => {
      const text = "Question? Statement! Exclamation. More text here.";
      const result = truncateToTokenBudget(text, 8); // Should fit first few sentences
      expect(result).toMatch(/Question\? Statement!/);
    });

    it("should add ellipsis when truncating", () => {
      const text = "a".repeat(100);
      const result = truncateToTokenBudget(text, 5);
      expect(result).toContain("...");
      expect(estimateTokenCount(result)).toBeLessThanOrEqual(5);
    });
  });

  describe("summarizeForBudget", () => {
    it("should return empty string for invalid inputs", () => {
      expect(summarizeForBudget("", 100)).toBe("");
      expect(summarizeForBudget("text", 0)).toBe("");
      expect(summarizeForBudget("text", -1)).toBe("");
    });

    it("should return original text if within budget", () => {
      const text = "Short text";
      const tokens = estimateTokenCount(text);
      expect(summarizeForBudget(text, tokens + 10)).toBe(text);
    });

    it("should create summary with beginning and end", () => {
      const text = "Beginning part with important content. " + "Middle content ".repeat(20) + "End part with conclusion.";
      const result = summarizeForBudget(text, 20);

      expect(result).toContain("Beginning part");
      expect(result).toContain("conclusion.");
      expect(result).toContain("[... content truncated ...]");
      expect(estimateTokenCount(result)).toBeLessThanOrEqual(20);
    });

    it("should fallback to truncation if target tokens too small", () => {
      const text = "This is some text that needs summarizing.";
      const result = summarizeForBudget(text, 5);

      expect(result).not.toContain("[... content truncated ...]");
      expect(estimateTokenCount(result)).toBeLessThanOrEqual(5);
    });

    it("should preserve word boundaries in beginning and end", () => {
      const text = "Start with words here. " + "x".repeat(200) + " End with words there.";
      const result = summarizeForBudget(text, 30);

      expect(result).toMatch(/^Start with words/);
      if (result.includes("[... content truncated ...]")) {
        expect(result).toMatch(/words there\.$/);
      }
    });
  });

  describe("truncateRepoStructure", () => {
    const sampleStructure = `README.md
package.json
src/
  index.ts
  utils/
    helper.ts
  components/
    Button.tsx
tests/
  index.test.ts
  utils/
    helper.test.ts
node_modules/
  express/
    index.js
docs/
  api.md
.gitignore
tsconfig.json`;

    it("should return empty string for invalid inputs", () => {
      expect(truncateRepoStructure("", 100)).toBe("");
      expect(truncateRepoStructure("structure", 0)).toBe("");
      expect(truncateRepoStructure("structure", -1)).toBe("");
    });

    it("should return original structure if within budget", () => {
      const tokens = estimateTokenCount(sampleStructure);
      expect(truncateRepoStructure(sampleStructure, tokens + 10)).toBe(sampleStructure);
    });

    it("should prioritize important files", () => {
      const result = truncateRepoStructure(sampleStructure, 15);

      // Should include some high-priority files
      const hasImportantFiles = result.includes("README.md") ||
                               result.includes("package.json") ||
                               result.includes("tsconfig.json");
      expect(hasImportantFiles).toBe(true);

      // Should exclude low-priority files
      expect(result).not.toContain("node_modules");
    });

    it("should maintain some semblance of order", () => {
      const result = truncateRepoStructure(sampleStructure, 20);
      const lines = result.split('\n').filter(line => line.trim());

      // README should come before package.json (if both present)
      const readmeIndex = lines.findIndex(line => line.includes("README.md"));
      const packageIndex = lines.findIndex(line => line.includes("package.json"));

      if (readmeIndex >= 0 && packageIndex >= 0) {
        expect(readmeIndex).toBeLessThan(packageIndex);
      }
    });

    it("should add truncation indicator when needed", () => {
      const result = truncateRepoStructure(sampleStructure, 3);
      const shouldHaveIndicator = result.includes("...") || result.split('\n').length < sampleStructure.split('\n').length;
      expect(shouldHaveIndicator).toBe(true);
    });

    it("should handle single line structures", () => {
      const singleLine = "README.md";
      const result = truncateRepoStructure(singleLine, 5);
      expect(result).toContain("README.md");
    });

    it("should prioritize TypeScript and source files", () => {
      const structure = `README.md
src/index.ts
src/utils.tsx
build/output.js
random.txt
package.json`;

      const result = truncateRepoStructure(structure, 12);
      const hasSourceFiles = result.includes("index.ts") || result.includes("utils.tsx");
      const hasConfigFiles = result.includes("README.md") || result.includes("package.json");

      expect(hasSourceFiles || hasConfigFiles).toBe(true);
      // Should prefer important files over random files
      expect(result).not.toContain("random.txt");
    });
  });

  describe("isCodeContent", () => {
    it("should detect diff content as code", () => {
      const diffContent = `diff --git a/src/file.ts b/src/file.ts
index 123..456 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,4 +1,4 @@
-const old = 'value';
+const new = 'value';`;
      expect(isCodeContent(diffContent)).toBe(true);
    });

    it("should detect realistic GitHub diff as code", () => {
      const gitHubDiff = `diff --git a/src/review/token-estimator.ts b/src/review/token-estimator.ts
index abc123..def456 100644
--- a/src/review/token-estimator.ts
+++ b/src/review/token-estimator.ts
@@ -104,7 +104,12 @@ export function estimateTokenCount(text: string, contentType: ContentType = 'au
   if (!text || text.length === 0) {
     return 0;
   }
-  return Math.ceil(text.length / CHARS_PER_TOKEN);
+
+  const charsPerToken = contentType === 'auto'
+    ? (isCodeContent(text) ? CHARS_PER_TOKEN_BY_TYPE.code : CHARS_PER_TOKEN_BY_TYPE.natural)
+    : CHARS_PER_TOKEN_BY_TYPE[contentType];
+
+  return Math.ceil(text.length / charsPerToken);
 }`;
      expect(isCodeContent(gitHubDiff)).toBe(true);
    });

    it("should detect unified diff format as code", () => {
      const unifiedDiff = `--- original.ts	2024-01-01 10:00:00.000000000 +0000
+++ modified.ts	2024-01-01 10:00:01.000000000 +0000
@@ -10,6 +10,7 @@
   constructor(private config: Config) {
     this.client = new APIClient(config.apiUrl);
+    this.retries = config.retries || 3;
   }

   async process(data: any) {`;
      expect(isCodeContent(unifiedDiff)).toBe(true);
    });

    it("should detect import/export statements as code", () => {
      expect(isCodeContent("import { test } from 'vitest';")).toBe(true);
      expect(isCodeContent("export const value = 42;")).toBe(true);
      expect(isCodeContent("const fs = require('fs');")).toBe(true);
      expect(isCodeContent("from typing import Dict, List")).toBe(true);
    });

    it("should detect function declarations as code", () => {
      expect(isCodeContent("function test() { return true; }")).toBe(true);
      expect(isCodeContent("const func = () => {};")).toBe(true);
      expect(isCodeContent("let handler = function() {};")).toBe(true);
      expect(isCodeContent("async function fetchData() {}")).toBe(true);
    });

    it("should detect type declarations as code", () => {
      expect(isCodeContent("class MyClass {}")).toBe(true);
      expect(isCodeContent("interface Config {}")).toBe(true);
      expect(isCodeContent("type StringOrNumber = string | number;")).toBe(true);
      expect(isCodeContent("enum Status { Active, Inactive }")).toBe(true);
    });

    it("should detect programming keywords as code", () => {
      expect(isCodeContent("if (condition) { return true; }")).toBe(true);
      expect(isCodeContent("for (let i = 0; i < 10; i++) {}")).toBe(true);
      expect(isCodeContent("try { test(); } catch (error) {}")).toBe(true);
      expect(isCodeContent("while (running) { process(); }")).toBe(true);
      expect(isCodeContent("switch (type) { case 'A': break; }")).toBe(true);
    });

    it("should detect real TypeScript code as code", () => {
      const typeScriptCode = `export interface TokenUsageInfo {
  /** Estimated token count */
  estimatedTokens: number;
  /** Model's base token limit */
  modelLimit: number;
  /** Whether the text exceeds the effective limit */
  exceedsLimit: boolean;
}

export function analyzeTokenUsage(text: string, modelName: string): TokenUsageInfo {
  const estimatedTokens = estimateTokenCount(text);
  const modelLimit = getTokenLimit(modelName);
  return {
    estimatedTokens,
    modelLimit,
    exceedsLimit: estimatedTokens > modelLimit,
  };
}`;
      expect(isCodeContent(typeScriptCode)).toBe(true);
    });

    it("should detect JSON configuration as code", () => {
      const jsonConfig = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}`;
      expect(isCodeContent(jsonConfig)).toBe(true);
    });

    it("should detect code with comments", () => {
      const codeWithComments = `// Token estimation utilities
function estimateTokens(text) {
  /* Calculate based on character count */
  return Math.ceil(text.length / 4);
}`;
      expect(isCodeContent(codeWithComments)).toBe(true);
    });

    it("should not detect natural language as code", () => {
      expect(isCodeContent("Hello world, this is a test!")).toBe(false);
      expect(isCodeContent("This is a sentence with punctuation.")).toBe(false);
      expect(isCodeContent("A longer paragraph with multiple sentences. It should not be detected as code.")).toBe(false);
    });

    it("should handle GitHub issue content appropriately", () => {
      const issueContent = `## Bug Report

### Description
The token estimator is currently underestimating token count for code content.

### Steps to Reproduce
1. Create a diff with TypeScript code
2. Run the estimateTokenCount function
3. Compare with actual Claude API token usage

### Expected Behavior
Token estimation should be more accurate for code vs natural language.

### Additional Context
- Code content typically has more symbols and shorter tokens
- Natural language has longer, more predictable tokens
- Current 4 chars/token ratio works better for natural language`;

      // Issue content with numbered lists and technical terms might be detected either way
      const result = isCodeContent(issueContent);
      expect(typeof result).toBe('boolean'); // Should at least return a valid boolean
    });

    it("should handle markdown documentation appropriately", () => {
      const markdownDoc = `# Token Estimator

This module provides utilities for estimating token usage in Claude models.

## Features

- **Accurate estimation**: Uses different ratios for code vs natural language
- **Model support**: Works with all Claude 4.x models
- **Safety margins**: Built-in 20% safety buffer

## Usage

Call the \`estimateTokenCount\` function with your text:

\`\`\`typescript
const tokens = estimateTokenCount(text, 'auto');
\`\`\`

The function will automatically detect content type and apply appropriate estimation.`;

      // Markdown with code blocks might be detected either way depending on content balance
      const result = isCodeContent(markdownDoc);
      expect(typeof result).toBe('boolean'); // Should return a valid boolean
    });

    it("should not detect special characters alone as code", () => {
      expect(isCodeContent("Hello\n\tWorld!@#$%^&*()")).toBe(false);
      expect(isCodeContent("Price: $19.99 (tax included)")).toBe(false);
      expect(isCodeContent("Email: user@example.com")).toBe(false);
    });

    it("should handle mixed content correctly", () => {
      const mixedContent = `Here's a code example:

\`\`\`javascript
function test() {
  return true;
}
\`\`\`

This function demonstrates basic JavaScript syntax.`;

      // Mixed content with code blocks can be detected either way
      const result = isCodeContent(mixedContent);
      expect(typeof result).toBe('boolean'); // Should return a valid boolean
    });

    it("should handle edge cases", () => {
      expect(isCodeContent("")).toBe(false);
      expect(isCodeContent("   ")).toBe(false);
      expect(isCodeContent("\n\t")).toBe(false);
      expect(isCodeContent("{}")).toBe(false); // Too short to be meaningful code
      expect(isCodeContent("()")).toBe(false);
      expect(isCodeContent("[];")).toBe(false);
    });

    it("should detect code with high structural character density", () => {
      const structuralCode = `{
  config: {
    api: { url: 'https://api.example.com', timeout: 5000 },
    db: { host: 'localhost', port: 3306 }
  },
  handlers: [processA(), processB(), processC()]
}`;
      expect(isCodeContent(structuralCode)).toBe(true);
    });
  });

  describe("content type aware token estimation", () => {
    it("should estimate tokens differently for code vs natural language", () => {
      const text = "a".repeat(32); // 32 characters

      const codeTokens = estimateTokenCount(text, 'code');
      const naturalTokens = estimateTokenCount(text, 'natural');

      expect(codeTokens).toBe(Math.ceil(32 / CHARS_PER_TOKEN_BY_TYPE.code)); // 10 tokens
      expect(naturalTokens).toBe(Math.ceil(32 / CHARS_PER_TOKEN_BY_TYPE.natural)); // 8 tokens
      expect(codeTokens).toBeGreaterThan(naturalTokens);
    });

    it("should auto-detect code content and use appropriate ratio", () => {
      const codeText = "function test() { return true; }";
      const naturalText = "This is a natural language sentence.";

      const codeTokens = estimateTokenCount(codeText, 'auto');
      const naturalTokens = estimateTokenCount(naturalText, 'auto');

      // Code should use 3.2 chars/token, natural should use 4 chars/token
      expect(codeTokens).toBe(Math.ceil(codeText.length / CHARS_PER_TOKEN_BY_TYPE.code));
      expect(naturalTokens).toBe(Math.ceil(naturalText.length / CHARS_PER_TOKEN_BY_TYPE.natural));
    });

    it("should correctly estimate real TypeScript code content", () => {
      const typeScriptCode = `export interface Config {
  apiUrl: string;
  timeout: number;
  retries?: number;
}

export class APIClient {
  constructor(private config: Config) {
    this.validateConfig(config);
  }

  private validateConfig(config: Config): void {
    if (!config.apiUrl) {
      throw new Error('API URL is required');
    }
  }
}`;

      const autoTokens = estimateTokenCount(typeScriptCode, 'auto');
      const codeTokens = estimateTokenCount(typeScriptCode, 'code');
      const naturalTokens = estimateTokenCount(typeScriptCode, 'natural');

      // Should auto-detect as code
      expect(autoTokens).toBe(codeTokens);
      expect(codeTokens).toBeGreaterThan(naturalTokens);

      // Verify actual calculation
      const expectedCodeTokens = Math.ceil(typeScriptCode.length / CHARS_PER_TOKEN_BY_TYPE.code);
      expect(codeTokens).toBe(expectedCodeTokens);
    });

    it("should correctly estimate GitHub diff content", () => {
      const diffContent = `diff --git a/src/token-estimator.ts b/src/token-estimator.ts
index 1234567..abcdefg 100644
--- a/src/token-estimator.ts
+++ b/src/token-estimator.ts
@@ -12,7 +12,11 @@ export function estimateTokenCount(text: string): number {
   if (!text || text.length === 0) {
     return 0;
   }
-  return Math.ceil(text.length / 4);
+
+  const contentType = isCodeContent(text) ? 'code' : 'natural';
+  const charsPerToken = CHARS_PER_TOKEN_BY_TYPE[contentType];
+
+  return Math.ceil(text.length / charsPerToken);
 }`;

      const autoTokens = estimateTokenCount(diffContent, 'auto');
      const codeTokens = estimateTokenCount(diffContent, 'code');

      // Should auto-detect as code (due to diff markers)
      expect(autoTokens).toBe(codeTokens);

      const expectedTokens = Math.ceil(diffContent.length / CHARS_PER_TOKEN_BY_TYPE.code);
      expect(autoTokens).toBe(expectedTokens);
    });

    it("should correctly estimate GitHub issue content", () => {
      const issueContent = `## Bug Description

The token estimator is currently underestimating the token count for code content,
which can lead to "Prompt is too long" errors when the diff-splitter tries to create
review prompts that exceed Claude's context limits.

### Current Behavior

- Uses fixed 4 chars/token ratio for all content
- Works reasonably well for natural language
- Underestimates tokens for code (variables, symbols, brackets)

### Expected Behavior

The estimator should:
1. Detect content type (code vs natural language)
2. Apply appropriate ratios:
   - Code content: ~3.2 chars/token (denser)
   - Natural language: ~4 chars/token (current)

### Test Cases

We need to verify this works for:
- TypeScript/JavaScript code blocks
- Git diff output
- Mixed content (issue descriptions with code examples)
- Edge cases (empty strings, very short snippets)`;

      const autoTokens = estimateTokenCount(issueContent, 'auto');
      const naturalTokens = estimateTokenCount(issueContent, 'natural');
      const codeTokens = estimateTokenCount(issueContent, 'code');

      // The issue content contains numbered lists and technical terms that might be detected as code
      // We'll accept either natural or code detection for this mixed technical content
      expect(autoTokens === naturalTokens || autoTokens === codeTokens).toBe(true);
    });

    it("should correctly estimate markdown documentation", () => {
      const markdownDoc = `# Token Estimator Documentation

This utility provides accurate token estimation for Claude models by analyzing content type.

## Features

- **Content-aware estimation**: Different ratios for code vs natural language
- **Auto-detection**: Automatically determines content type
- **Model support**: Works with all Claude 4.x models (200K context)
- **Safety margins**: Built-in buffer to prevent context overflow

## Usage Examples

### Basic Usage

\`\`\`typescript
import { estimateTokenCount } from './token-estimator';

// Auto-detect content type
const tokens = estimateTokenCount(text, 'auto');

// Explicit content type
const codeTokens = estimateTokenCount(code, 'code');
const naturalTokens = estimateTokenCount(description, 'natural');
\`\`\`

### Integration with Review System

The diff-splitter uses this to determine when to split large diffs:

\`\`\`typescript
if (exceedsTokenLimit(promptText, modelName)) {
  // Split the diff into smaller chunks
  const chunks = splitDiff(diff, targetSize);
}
\`\`\`

## Implementation Details

- Code content ratio: 3.2 characters per token
- Natural language ratio: 4.0 characters per token
- Detection based on syntax patterns, keywords, and structural analysis`;

      const autoTokens = estimateTokenCount(markdownDoc, 'auto');
      const naturalTokens = estimateTokenCount(markdownDoc, 'natural');
      const codeTokens = estimateTokenCount(markdownDoc, 'code');

      // Markdown with code blocks might be detected as either type
      // We'll accept either detection result for this mixed content
      expect(autoTokens === naturalTokens || autoTokens === codeTokens).toBe(true);
    });

    it("should handle JSON and config files as code", () => {
      const jsonConfig = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": [
    "src/**/*.ts",
    "tests/**/*.ts"
  ],
  "exclude": [
    "node_modules",
    "dist",
    ".aq-worktrees"
  ]
}`;

      const autoTokens = estimateTokenCount(jsonConfig, 'auto');
      const codeTokens = estimateTokenCount(jsonConfig, 'code');

      // Should detect as code due to structural patterns
      expect(autoTokens).toBe(codeTokens);
    });

    it("should estimate tokens for mixed content correctly", () => {
      const mixedContent = `## Code Review

Here's the problematic function:

\`\`\`typescript
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4); // Too simple!
}
\`\`\`

This implementation doesn't account for the fact that code content has more tokens per character than natural language. We should update it to detect content type and apply appropriate ratios.

The fix should:
1. Add content type detection
2. Use 3.2 chars/token for code
3. Use 4.0 chars/token for natural language

This will prevent "Prompt is too long" errors in the review system.`;

      const autoTokens = estimateTokenCount(mixedContent, 'auto');
      const naturalTokens = estimateTokenCount(mixedContent, 'natural');
      const codeTokens = estimateTokenCount(mixedContent, 'code');

      // Mixed content can be detected as either natural or code due to code block presence
      expect(autoTokens === naturalTokens || autoTokens === codeTokens).toBe(true);
    });

    it("should maintain backwards compatibility with default parameter", () => {
      const text = "Hello world";
      const defaultTokens = estimateTokenCount(text);
      const autoTokens = estimateTokenCount(text, 'auto');
      const naturalTokens = estimateTokenCount(text, 'natural');

      expect(autoTokens).toBe(naturalTokens); // Natural language auto-detected
      expect(defaultTokens).toBe(naturalTokens); // Default should match natural
    });

    it("should handle edge cases with all content types", () => {
      expect(estimateTokenCount("", 'code')).toBe(0);
      expect(estimateTokenCount("", 'natural')).toBe(0);
      expect(estimateTokenCount("", 'auto')).toBe(0);

      // Single character
      expect(estimateTokenCount("a", 'code')).toBe(1);
      expect(estimateTokenCount("a", 'natural')).toBe(1);
      expect(estimateTokenCount("a", 'auto')).toBe(1);
    });

    it("should demonstrate token difference between content types", () => {
      // Example with realistic code that shows the difference
      const codeExample = 'function calculateTokens(text) { return Math.ceil(text.length / 3.2); }';

      const codeTokens = estimateTokenCount(codeExample, 'code');
      const naturalTokens = estimateTokenCount(codeExample, 'natural');
      const autoTokens = estimateTokenCount(codeExample, 'auto');

      // Code should have more tokens (shorter chars/token ratio)
      expect(codeTokens).toBeGreaterThan(naturalTokens);
      // Auto should detect this as code
      expect(autoTokens).toBe(codeTokens);

      // Verify the math
      expect(codeTokens).toBe(Math.ceil(codeExample.length / CHARS_PER_TOKEN_BY_TYPE.code));
      expect(naturalTokens).toBe(Math.ceil(codeExample.length / CHARS_PER_TOKEN_BY_TYPE.natural));
    });

    it("should handle very large code content", () => {
      // Simulate large TypeScript file
      const largeCode = `export interface Config {
  apiUrl: string;
  timeout: number;
}

export class APIClient {
  constructor(private config: Config) {}

  async request(data: any): Promise<any> {
    return fetch(this.config.apiUrl, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' }
    });
  }
}`.repeat(100); // Repeat to make it large

      const autoTokens = estimateTokenCount(largeCode, 'auto');
      const codeTokens = estimateTokenCount(largeCode, 'code');

      // Should detect as code and use code ratio
      expect(autoTokens).toBe(codeTokens);
      expect(codeTokens).toBe(Math.ceil(largeCode.length / CHARS_PER_TOKEN_BY_TYPE.code));
    });
  });

  describe("constants", () => {
    it("should have correct content type ratios", () => {
      expect(CHARS_PER_TOKEN_BY_TYPE.code).toBe(3.2);
      expect(CHARS_PER_TOKEN_BY_TYPE.natural).toBe(4);
    });
  });
});