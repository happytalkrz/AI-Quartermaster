import { readFileSync } from "fs";

export interface TemplateVariables {
  [key: string]: string | number | boolean | string[] | TemplateVariables;
}

function resolvePath(
  variables: TemplateVariables,
  path: string
): string | undefined {
  const parts = path.split(".");
  let current: string | number | boolean | string[] | TemplateVariables =
    variables;

  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    const obj = current as TemplateVariables;
    if (!Object.prototype.hasOwnProperty.call(obj, part)) {
      return undefined;
    }
    current = obj[part];
  }

  if (current === undefined || current === null) {
    return undefined;
  }
  if (Array.isArray(current)) {
    return current.join(", ");
  }
  if (typeof current === "boolean" || typeof current === "number") {
    return String(current);
  }
  if (typeof current === "string") {
    return current;
  }
  // TemplateVariables object - not directly renderable, return undefined
  return undefined;
}

export function renderTemplate(
  template: string,
  variables: TemplateVariables
): string {
  // Match {{var}}, {{ var }}, {{nested.path}}, {{ nested.path }} (double-brace)
  // Also match {var}, {nested.path} (single-brace, but not already double-brace)
  return template
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
      const value = resolvePath(variables, path.trim());
      return value !== undefined ? value : _match;
    })
    .replace(/(?<!\{)\{([\w.]+)\}(?!\})/g, (_match, path: string) => {
      const value = resolvePath(variables, path.trim());
      return value !== undefined ? value : _match;
    });
}

export function loadTemplate(templatePath: string): string {
  try {
    return readFileSync(templatePath, "utf-8");
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    if (error.code === "ENOENT") {
      throw new Error(`Template file not found: ${templatePath}`);
    }
    throw new Error(
      `Failed to read template file ${templatePath}: ${error.message}`
    );
  }
}
