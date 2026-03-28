import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { AQConfig } from "../types/config.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { validateConfig } from "./validator.js";

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
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }

  return validateConfig(config);
}
