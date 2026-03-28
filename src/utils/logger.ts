import { LogLevel } from "../types/config.js";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

let globalLevel: LogLevel = "info";

export function setGlobalLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getLogger(): Logger {
  return {
    debug(message: string, ...args: unknown[]): void {
      if (LEVEL_RANK[globalLevel] <= 0) {
        console.log(formatMessage("debug", message), ...args);
      }
    },
    info(message: string, ...args: unknown[]): void {
      if (LEVEL_RANK[globalLevel] <= 1) {
        console.log(formatMessage("info", message), ...args);
      }
    },
    warn(message: string, ...args: unknown[]): void {
      if (LEVEL_RANK[globalLevel] <= 2) {
        console.warn(formatMessage("warn", message), ...args);
      }
    },
    error(message: string, ...args: unknown[]): void {
      if (LEVEL_RANK[globalLevel] <= 3) {
        console.error(formatMessage("error", message), ...args);
      }
    },
  };
}

export function createLogger(level: LogLevel): Logger {
  const minRank = LEVEL_RANK[level];

  return {
    debug(message: string, ...args: unknown[]): void {
      if (LEVEL_RANK.debug >= minRank) {
        console.log(formatMessage("debug", message), ...args);
      }
    },
    info(message: string, ...args: unknown[]): void {
      if (LEVEL_RANK.info >= minRank) {
        console.log(formatMessage("info", message), ...args);
      }
    },
    warn(message: string, ...args: unknown[]): void {
      if (LEVEL_RANK.warn >= minRank) {
        console.warn(formatMessage("warn", message), ...args);
      }
    },
    error(message: string, ...args: unknown[]): void {
      if (LEVEL_RANK.error >= minRank) {
        console.error(formatMessage("error", message), ...args);
      }
    },
  };
}
