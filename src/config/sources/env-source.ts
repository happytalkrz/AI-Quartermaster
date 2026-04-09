import { parseEnvVars } from "../env-parser.js";

export interface EnvSourceOptions {
  envVars?: Record<string, string | undefined>;
}

export interface EnvSourceResult {
  config: Record<string, unknown>;
  error?: {
    type: 'parsing';
    message: string;
  };
}

/**
 * 환경변수(AQM_*)를 파싱하여 config 객체로 변환
 */
export function loadEnvSource(options: EnvSourceOptions = {}): EnvSourceResult {
  try {
    const envVars = options.envVars ?? process.env;
    const config = parseEnvVars(envVars);
    return { config };
  } catch (error: unknown) {
    return {
      config: {},
      error: {
        type: 'parsing',
        message: `Failed to parse environment variables: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    };
  }
}