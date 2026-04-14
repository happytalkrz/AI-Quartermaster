import { readFileSync } from "fs";

export interface DetectWSLOptions {
  osreleasePath?: string;
  env?: Record<string, string | undefined>;
}

export function detectWSL(options?: DetectWSLOptions): boolean {
  const env = options?.env ?? process.env;
  if (env["WSL_DISTRO_NAME"] || env["WSL_INTEROP"]) return true;
  const osreleasePath = options?.osreleasePath ?? "/proc/sys/kernel/osrelease";
  try {
    const release = readFileSync(osreleasePath, "utf-8").toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    // 파일 읽기 실패 시 WSL이 아닌 것으로 처리 (의도적 무시)
    return false;
  }
}
