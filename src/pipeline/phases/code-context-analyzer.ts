import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import * as ts from "typescript";
import type { ContextualizationInfo } from "../../types/pipeline.js";
import { getLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/error-utils.js";

const logger = getLogger();

/**
 * Plan 생성 실패 시 영향 파일들의 함수 시그니처·import/export·타입 정의를 수집한다.
 *
 * @param affectedFiles 영향받는 파일 경로 배열
 * @param cwd 작업 디렉토리 기준 경로
 */
export function collectContextualizationInfo(
  affectedFiles: string[],
  cwd: string,
): ContextualizationInfo {
  const functionSignatures: { [filePath: string]: string[] } = {};
  const importRelations: { [filePath: string]: { imports: string[]; exports: string[] } } = {};
  const typeDefinitions: { [filePath: string]: string[] } = {};

  for (const filePath of affectedFiles) {
    const fullPath = resolve(cwd, filePath);

    if (!existsSync(fullPath) || !isTypeScriptOrJavaScriptFile(filePath)) {
      continue;
    }

    try {
      const content = readFileSync(fullPath, "utf-8");

      functionSignatures[filePath] = extractFunctionSignatures(filePath, content);
      importRelations[filePath] = extractImportRelations(filePath, content);
      typeDefinitions[filePath] = extractTypeDefinitions(filePath, content);

      logger.debug(
        `Collected context for ${filePath}: ${functionSignatures[filePath].length} functions, ${importRelations[filePath].imports.length} imports, ${typeDefinitions[filePath].length} types`,
      );
    } catch (error: unknown) {
      logger.warn(`Failed to collect context for ${filePath}: ${getErrorMessage(error)}`);
      functionSignatures[filePath] = [];
      importRelations[filePath] = { imports: [], exports: [] };
      typeDefinitions[filePath] = [];
    }
  }

  return { functionSignatures, importRelations, typeDefinitions };
}

function isTypeScriptOrJavaScriptFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx)$/.test(filePath);
}

function createSourceFile(filePath: string, content: string): ts.SourceFile {
  const isTsx = filePath.endsWith(".tsx") || filePath.endsWith(".jsx");
  return ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function extractFunctionSignatures(filePath: string, content: string): string[] {
  const signatures: string[] = [];
  try {
    visitNodeForSignatures(createSourceFile(filePath, content), signatures);
  } catch (_error: unknown) {
    return extractFunctionSignaturesRegex(content);
  }
  return signatures;
}

function visitNodeForSignatures(node: ts.Node, signatures: string[]): void {
  if (ts.isFunctionDeclaration(node) && node.name) {
    const signature = getFunctionSignature(node);
    if (signature) signatures.push(signature);
  } else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
    const signature = getMethodSignature(node);
    if (signature) signatures.push(signature);
  } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && parent.name && ts.isIdentifier(parent.name)) {
      signatures.push(`${parent.name.text}: ${node.getText().substring(0, 100)}...`);
    }
  }
  ts.forEachChild(node, (child) => visitNodeForSignatures(child, signatures));
}

function getFunctionSignature(node: ts.FunctionDeclaration): string | null {
  if (!node.name) return null;
  const name = node.name.text;
  const params = node.parameters
    .map((param) => `${param.name.getText()}: ${param.type ? param.type.getText() : "any"}`)
    .join(", ");
  const returnType = node.type ? node.type.getText() : "void";
  const asyncKeyword = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? "async " : "";
  const exportKeyword = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ? "export " : "";
  return `${exportKeyword}${asyncKeyword}function ${name}(${params}): ${returnType}`;
}

function getMethodSignature(node: ts.MethodDeclaration | ts.MethodSignature): string | null {
  const name = node.name?.getText();
  if (!name) return null;
  const params = node.parameters
    .map((param) => `${param.name.getText()}: ${param.type ? param.type.getText() : "any"}`)
    .join(", ");
  const returnType = node.type ? node.type.getText() : "void";
  const asyncKeyword = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? "async " : "";
  return `${asyncKeyword}${name}(${params}): ${returnType}`;
}

function extractFunctionSignaturesRegex(content: string): string[] {
  const signatures: string[] = [];
  const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)(?:\s*:\s*[^{]+)?/g;
  let match;
  while ((match = functionRegex.exec(content)) !== null) {
    signatures.push(match[0]);
  }
  const arrowFunctionRegex = /(?:export\s+)?const\s+(\w+)\s*[:=]\s*(?:async\s+)?\([^)]*\)\s*=>/g;
  while ((match = arrowFunctionRegex.exec(content)) !== null) {
    signatures.push(match[0] + "...");
  }
  return signatures;
}

function extractImportRelations(
  filePath: string,
  content: string,
): { imports: string[]; exports: string[] } {
  const imports: string[] = [];
  const exports: string[] = [];
  try {
    visitNodeForImports(createSourceFile(filePath, content), imports, exports);
  } catch (_error: unknown) {
    return extractImportRelationsRegex(content);
  }
  return { imports, exports };
}

function visitNodeForImports(node: ts.Node, imports: string[], exports: string[]): void {
  if (ts.isImportDeclaration(node)) {
    imports.push(node.getText());
  } else if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
    exports.push(node.getText());
  } else if (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.ExportKeyword)
  ) {
    exports.push(node.getText().substring(0, 100) + "...");
  }
  ts.forEachChild(node, (child) => visitNodeForImports(child, imports, exports));
}

function extractImportRelationsRegex(content: string): { imports: string[]; exports: string[] } {
  const imports: string[] = [];
  const exports: string[] = [];
  const importRegex = /import\s+.*?from\s+["'].*?["'];?/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[0]);
  }
  const exportRegex = /export\s+.*?(?:[;}]|$)/gm;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[0]);
  }
  return { imports, exports };
}

function extractTypeDefinitions(filePath: string, content: string): string[] {
  const typeDefinitions: string[] = [];
  try {
    visitNodeForTypes(createSourceFile(filePath, content), typeDefinitions);
  } catch (_error: unknown) {
    return extractTypeDefinitionsRegex(content);
  }
  return typeDefinitions;
}

function visitNodeForTypes(node: ts.Node, typeDefinitions: string[]): void {
  if (ts.isTypeAliasDeclaration(node)) {
    typeDefinitions.push(node.getText());
  } else if (ts.isInterfaceDeclaration(node)) {
    typeDefinitions.push(node.getText());
  } else if (ts.isEnumDeclaration(node)) {
    typeDefinitions.push(node.getText());
  } else if (ts.isClassDeclaration(node)) {
    const className = node.name?.text || "Unknown";
    typeDefinitions.push(
      `class ${className}${node.heritageClauses ? " extends/implements..." : ""}`,
    );
  }
  ts.forEachChild(node, (child) => visitNodeForTypes(child, typeDefinitions));
}

function extractTypeDefinitionsRegex(content: string): string[] {
  const typeDefinitions: string[] = [];
  const interfaceRegex = /(?:export\s+)?interface\s+\w+\s*(?:<[^>]*>)?\s*(?:extends\s+[^{]*)?\s*\{[^}]*\}/gs;
  let match;
  while ((match = interfaceRegex.exec(content)) !== null) {
    typeDefinitions.push(match[0]);
  }
  const typeRegex = /(?:export\s+)?type\s+\w+(?:<[^>]*>)?\s*=\s*[^;]+;?/g;
  while ((match = typeRegex.exec(content)) !== null) {
    typeDefinitions.push(match[0]);
  }
  const enumRegex = /(?:export\s+)?enum\s+\w+\s*\{[^}]*\}/gs;
  while ((match = enumRegex.exec(content)) !== null) {
    typeDefinitions.push(match[0]);
  }
  const classRegex = /(?:export\s+)?class\s+\w+(?:\s+extends\s+\w+)?(?:\s+implements\s+[^{]*)?\s*\{/g;
  while ((match = classRegex.exec(content)) !== null) {
    typeDefinitions.push(match[0] + "...}");
  }
  return typeDefinitions;
}
