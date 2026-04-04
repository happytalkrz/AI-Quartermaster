import { describe, it, expect } from "vitest";
import {
  splitDiffByFiles,
  groupFilesByTokenBudget,
  combineBatchDiffs,
  generateSplitStats,
  type FileDiff,
  type FileDiffBatch,
} from "../../src/review/diff-splitter.js";
import { estimateTokenCount } from "../../src/review/token-estimator.js";

describe("diff-splitter", () => {
  describe("splitDiffByFiles", () => {
    it("should return empty array for empty diff", () => {
      expect(splitDiffByFiles("")).toEqual([]);
      expect(splitDiffByFiles("   ")).toEqual([]);
    });

    it("should split single file diff correctly", () => {
      const singleFileDiff = `diff --git a/src/test.ts b/src/test.ts
index abc123..def456 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,4 @@
 function test() {
+  console.log('new line');
   return true;
 }`;

      const result = splitDiffByFiles(singleFileDiff);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe("src/test.ts");
      expect(result[0].diffContent).toContain("diff --git");
      expect(result[0].diffContent).toContain("console.log");
      expect(result[0].estimatedTokens).toBeGreaterThan(0);
    });

    it("should split multiple file diffs correctly", () => {
      const multiFileDiff = `diff --git a/src/file1.ts b/src/file1.ts
index abc123..def456 100644
--- a/src/file1.ts
+++ b/src/file1.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
 export { x };

diff --git a/src/file2.ts b/src/file2.ts
index ghi789..jkl012 100644
--- a/src/file2.ts
+++ b/src/file2.ts
@@ -1,3 +1,4 @@
 import { x } from './file1';
+import { y } from './file1';

 console.log(x);`;

      const result = splitDiffByFiles(multiFileDiff);

      expect(result).toHaveLength(2);
      expect(result[0].filePath).toBe("src/file1.ts");
      expect(result[1].filePath).toBe("src/file2.ts");
      expect(result[0].diffContent).toContain("const y = 2");
      expect(result[1].diffContent).toContain("import { y }");
      expect(result[0].estimatedTokens).toBeGreaterThan(0);
      expect(result[1].estimatedTokens).toBeGreaterThan(0);
    });

    it("should handle file renames correctly", () => {
      const renameDiff = `diff --git a/old-name.ts b/new-name.ts
similarity index 88%
rename from old-name.ts
rename to new-name.ts
index abc123..def456 100644
--- a/old-name.ts
+++ b/new-name.ts
@@ -1,2 +1,3 @@
 const renamed = true;
+// This file was renamed
 export { renamed };`;

      const result = splitDiffByFiles(renameDiff);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe("new-name.ts"); // should use the new name
      expect(result[0].diffContent).toContain("rename to");
    });

    it("should handle files with spaces in path", () => {
      const spaceDiff = `diff --git a/src/file with spaces.ts b/src/file with spaces.ts
index abc123..def456 100644
--- a/src/file with spaces.ts
+++ b/src/file with spaces.ts
@@ -1,1 +1,2 @@
 // File with spaces
+const spaced = true;`;

      const result = splitDiffByFiles(spaceDiff);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe("src/file with spaces.ts");
    });

    it("should handle new file creation", () => {
      const newFileDiff = `diff --git a/new-file.ts b/new-file.ts
new file mode 100644
index 0000000..abc123
--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,3 @@
+export const newFile = true;
+
+// This is a new file`;

      const result = splitDiffByFiles(newFileDiff);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe("new-file.ts");
      expect(result[0].diffContent).toContain("new file mode");
    });

    it("should handle file deletion", () => {
      const deleteDiff = `diff --git a/deleted-file.ts b/deleted-file.ts
deleted file mode 100644
index abc123..0000000
--- a/deleted-file.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export const deleted = true;
-
-// This file will be deleted`;

      const result = splitDiffByFiles(deleteDiff);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe("deleted-file.ts");
      expect(result[0].diffContent).toContain("deleted file mode");
    });

    it("should ignore malformed diff sections", () => {
      const malformedDiff = `Some random text without diff header
This should be ignored

diff --git a/valid-file.ts b/valid-file.ts
index abc123..def456 100644
--- a/valid-file.ts
+++ b/valid-file.ts
@@ -1,1 +1,2 @@
 const valid = true;
+const added = true;

Another invalid section without proper header`;

      const result = splitDiffByFiles(malformedDiff);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe("valid-file.ts");
    });
  });

  describe("groupFilesByTokenBudget", () => {
    const createFileDiff = (path: string, content: string): FileDiff => ({
      filePath: path,
      diffContent: content,
      estimatedTokens: estimateTokenCount(content, 'code'), // Use actual estimator with code content type
    });

    it("should return empty array for empty input", () => {
      const result = groupFilesByTokenBudget([], 1000);
      expect(result).toEqual([]);
    });

    it("should group files within token budget", () => {
      const files = [
        createFileDiff("file1.ts", "a".repeat(100)), // ~25 tokens
        createFileDiff("file2.ts", "b".repeat(200)), // ~50 tokens
        createFileDiff("file3.ts", "c".repeat(300)), // ~75 tokens
      ];

      const batches = groupFilesByTokenBudget(files, 100); // 100 token budget

      expect(batches).toHaveLength(2);
      expect(batches[0].files).toHaveLength(2); // file1 + file2 = 75 tokens
      expect(batches[0].files[0].filePath).toBe("file1.ts");
      expect(batches[0].files[1].filePath).toBe("file2.ts");
      expect(batches[1].files).toHaveLength(1); // file3 = 75 tokens
      expect(batches[1].files[0].filePath).toBe("file3.ts");
    });

    it("should handle single file per batch when files are large", () => {
      const files = [
        createFileDiff("large1.ts", "x".repeat(400)), // ~100 tokens
        createFileDiff("large2.ts", "y".repeat(400)), // ~100 tokens
      ];

      const batches = groupFilesByTokenBudget(files, 120); // 120 token budget

      expect(batches).toHaveLength(2);
      expect(batches[0].files).toHaveLength(1);
      expect(batches[1].files).toHaveLength(1);
      expect(batches[0].batchIndex).toBe(0);
      expect(batches[1].batchIndex).toBe(1);
    });

    it("should account for additional content tokens", () => {
      const files = [
        createFileDiff("file1.ts", "a".repeat(200)), // ~63 tokens (200/3.2)
        createFileDiff("file2.ts", "b".repeat(200)), // ~63 tokens (200/3.2)
      ];

      const additionalContent = "z".repeat(200); // ~50 tokens (auto-detected as natural)
      const batches = groupFilesByTokenBudget(files, 150, additionalContent);

      // Budget: 150, Additional: 50, Effective: 100
      // Each file: ~63 tokens, so 126 total > 100 effective budget
      expect(batches).toHaveLength(2); // Split into 2 batches
      expect(batches[0].files).toHaveLength(1);
      expect(batches[1].files).toHaveLength(1);
    });

    it("should handle case where additional content exceeds budget", () => {
      const files = [
        createFileDiff("small.ts", "a".repeat(40)), // ~10 tokens
      ];

      const additionalContent = "z".repeat(400); // ~100 tokens
      const batches = groupFilesByTokenBudget(files, 80, additionalContent); // budget < additional

      expect(batches).toHaveLength(1);
      expect(batches[0].files).toHaveLength(1);
      // Should automatically adjust budget to accommodate additional content
    });

    it("should set correct batch indices", () => {
      const files = Array.from({ length: 5 }, (_, i) =>
        createFileDiff(`file${i}.ts`, "x".repeat(100))
      ); // ~32 tokens each (100/3.2)

      const batches = groupFilesByTokenBudget(files, 60); // 1 file per batch (32*2=64 > 60)

      expect(batches).toHaveLength(5);
      expect(batches[0].batchIndex).toBe(0);
      expect(batches[1].batchIndex).toBe(1);
      expect(batches[2].batchIndex).toBe(2);
      expect(batches[3].batchIndex).toBe(3);
      expect(batches[4].batchIndex).toBe(4);
    });

    it("should handle zero token files", () => {
      const files = [
        createFileDiff("empty.ts", ""), // 0 tokens
        createFileDiff("small.ts", "ab"), // 1 token
      ];

      const batches = groupFilesByTokenBudget(files, 10);

      expect(batches).toHaveLength(1);
      expect(batches[0].files).toHaveLength(2);
      expect(batches[0].totalEstimatedTokens).toBe(1);
    });
  });

  describe("combineBatchDiffs", () => {
    it("should return empty string for empty batch", () => {
      const emptyBatch: FileDiffBatch = {
        files: [],
        totalEstimatedTokens: 0,
        batchIndex: 0,
      };

      expect(combineBatchDiffs(emptyBatch)).toBe("");
    });

    it("should combine single file diff", () => {
      const batch: FileDiffBatch = {
        files: [
          {
            filePath: "test.ts",
            diffContent: "diff --git a/test.ts b/test.ts\n+new line",
            estimatedTokens: 10,
          },
        ],
        totalEstimatedTokens: 10,
        batchIndex: 0,
      };

      const result = combineBatchDiffs(batch);

      expect(result).toBe("diff --git a/test.ts b/test.ts\n+new line");
    });

    it("should combine multiple file diffs with separator", () => {
      const batch: FileDiffBatch = {
        files: [
          {
            filePath: "file1.ts",
            diffContent: "diff --git a/file1.ts b/file1.ts\n+line1",
            estimatedTokens: 10,
          },
          {
            filePath: "file2.ts",
            diffContent: "diff --git a/file2.ts b/file2.ts\n+line2",
            estimatedTokens: 10,
          },
        ],
        totalEstimatedTokens: 20,
        batchIndex: 0,
      };

      const result = combineBatchDiffs(batch);

      expect(result).toBe(
        "diff --git a/file1.ts b/file1.ts\n+line1\n\ndiff --git a/file2.ts b/file2.ts\n+line2"
      );
    });
  });

  describe("generateSplitStats", () => {
    it("should generate correct statistics", () => {
      const fileDiffs: FileDiff[] = [
        { filePath: "file1.ts", diffContent: "content1", estimatedTokens: 10 },
        { filePath: "file2.ts", diffContent: "content2", estimatedTokens: 20 },
        { filePath: "file3.ts", diffContent: "content3", estimatedTokens: 30 },
      ];

      const batches: FileDiffBatch[] = [
        {
          files: [fileDiffs[0], fileDiffs[1]],
          totalEstimatedTokens: 30,
          batchIndex: 0,
        },
        {
          files: [fileDiffs[2]],
          totalEstimatedTokens: 30,
          batchIndex: 1,
        },
      ];

      const stats = generateSplitStats(fileDiffs, batches);

      expect(stats.totalFiles).toBe(3);
      expect(stats.totalBatches).toBe(2);
      expect(stats.totalTokens).toBe(60);
      expect(stats.filesPerBatch).toEqual([2, 1]);
      expect(stats.tokensPerBatch).toEqual([30, 30]);
    });

    it("should handle empty inputs", () => {
      const stats = generateSplitStats([], []);

      expect(stats.totalFiles).toBe(0);
      expect(stats.totalBatches).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.filesPerBatch).toEqual([]);
      expect(stats.tokensPerBatch).toEqual([]);
    });
  });

  describe("integration test", () => {
    it("should handle complete diff splitting workflow", () => {
      const complexDiff = `diff --git a/src/utils.ts b/src/utils.ts
index abc123..def456 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,5 +1,6 @@
 export function helper() {
+  console.log('helper called');
   return 'helper';
 }

 export const constant = 42;

diff --git a/src/main.ts b/src/main.ts
index ghi789..jkl012 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,5 @@
 import { helper } from './utils';
+import { constant } from './utils';

-console.log(helper());
+console.log(helper(), constant);`;

      // Step 1: Split by files
      const fileDiffs = splitDiffByFiles(complexDiff);
      expect(fileDiffs).toHaveLength(2);

      // Step 2: Group by token budget
      const batches = groupFilesByTokenBudget(fileDiffs, 200);
      expect(batches.length).toBeGreaterThan(0);

      // Step 3: Generate stats
      const stats = generateSplitStats(fileDiffs, batches);
      expect(stats.totalFiles).toBe(2);
      expect(stats.totalBatches).toBe(batches.length);

      // Step 4: Combine batch diffs
      for (const batch of batches) {
        const combinedDiff = combineBatchDiffs(batch);
        expect(combinedDiff).toContain("diff --git");
      }
    });
  });
});