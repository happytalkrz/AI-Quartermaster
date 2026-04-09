export interface CliSourceOptions {
  configOverrides?: Record<string, unknown>;
}

export interface CliSourceResult {
  config: Record<string, unknown>;
  error?: {
    type: 'validation';
    message: string;
  };
}

/**
 * CLI에서 전달된 config 오버라이드를 처리
 */
export function loadCliSource(options: CliSourceOptions = {}): CliSourceResult {
  try {
    const config = options.configOverrides ?? {};
    return { config };
  } catch (error: unknown) {
    return {
      config: {},
      error: {
        type: 'validation',
        message: `Failed to apply config overrides: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    };
  }
}