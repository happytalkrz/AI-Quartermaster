import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { AQConfig } from "../types/config.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { validateConfig } from "./validator.js";

export interface TryLoadConfigResult {
  config: AQConfig | null;
  error?: {
    type: 'not_found' | 'yaml_syntax' | 'validation';
    message: string;
    details?: string[];
  };
}

// Deep merge helper - recursively merges source into target
// Arrays in source replace arrays in target (no concat)
export function deepMerge(target: any, source: any): any {
  if (source === null || source === undefined) {
    return target;
  }
  if (typeof source !== "object" || Array.isArray(source)) {
    return source;
  }
  if (typeof target !== "object" || Array.isArray(target)) {
    return source;
  }

  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    result[key] = deepMerge(target[key], source[key]);
  }
  return result;
}

export function loadConfig(projectRoot: string): AQConfig {
  const baseConfigPath = `${projectRoot}/config.yml`;
  const localConfigPath = `${projectRoot}/config.local.yml`;

  let config = structuredClone(DEFAULT_CONFIG);

  if (!existsSync(baseConfigPath)) {
    throw new Error(`config.yml not found at ${baseConfigPath}`);
  }

  const baseRaw = parseYaml(readFileSync(baseConfigPath, "utf-8"));
  config = deepMerge(config, baseRaw);

  try {
    const localRaw = parseYaml(readFileSync(localConfigPath, "utf-8"));
    config = deepMerge(config, localRaw);
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  return validateConfig(config);
}

export function tryLoadConfig(projectRoot: string): TryLoadConfigResult {
  const baseConfigPath = `${projectRoot}/config.yml`;
  const localConfigPath = `${projectRoot}/config.local.yml`;

  // Check if base config exists
  if (!existsSync(baseConfigPath)) {
    return {
      config: null,
      error: {
        type: 'not_found',
        message: `config.yml not found at ${baseConfigPath}`
      }
    };
  }

  let config = structuredClone(DEFAULT_CONFIG);

  // Try to parse base config
  try {
    const baseRaw = parseYaml(readFileSync(baseConfigPath, "utf-8"));
    config = deepMerge(config, baseRaw);
  } catch (err: unknown) {
    return {
      config: null,
      error: {
        type: 'yaml_syntax',
        message: `Failed to parse config.yml: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    };
  }

  // Try to merge local config if exists
  try {
    const localRaw = parseYaml(readFileSync(localConfigPath, "utf-8"));
    config = deepMerge(config, localRaw);
  } catch (err: unknown) {
    // Only fail on non-ENOENT errors (file exists but can't parse)
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
      return {
        config: null,
        error: {
          type: 'yaml_syntax',
          message: `Failed to parse config.local.yml: ${err.message}`
        }
      };
    }
  }

  // Try to validate config
  try {
    const validatedConfig = validateConfig(config);
    return { config: validatedConfig };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown validation error';
    const lines = message.split('\n');
    const details = lines.length > 1
      ? lines.slice(1).filter(line => line.trim())
      : undefined;

    return {
      config: null,
      error: {
        type: 'validation',
        message: lines[0] || 'Validation failed',
        details: details?.length ? details : undefined
      }
    };
  }
}
