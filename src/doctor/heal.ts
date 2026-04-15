import { execFile, spawn } from "child_process";
import { getErrorMessage } from "../utils/error-utils.js";

export interface DoctorCheck {
  id: string;
  name: string;
  status: "pass" | "warn" | "fail" | "pending";
  healLevel: 1 | 2 | 3;
  /** Level1: [cmd, ...args] — execFile로 비대화형 자동 실행 */
  autoFixCommand?: string[];
  /** Level2: [cmd, ...args] — spawn으로 스트리밍 실행 */
  healCommand?: string[];
  /** Level3: 수동 복구 안내 텍스트 */
  guide?: string;
  docsUrl?: string;
}

export interface AutoFixResult {
  success: boolean;
  output: string;
}

/**
 * Level1 실행기: autoFixCommand를 execFile로 실행하고 성공/실패를 반환한다.
 * 비대화형(non-interactive) 커맨드에 적합.
 */
export function executeAutoFix(check: DoctorCheck): Promise<AutoFixResult> {
  return new Promise((resolve) => {
    if (!check.autoFixCommand || check.autoFixCommand.length === 0) {
      resolve({ success: false, output: "autoFixCommand가 정의되지 않았습니다" });
      return;
    }

    const [cmd, ...args] = check.autoFixCommand;
    execFile(cmd, args, { timeout: 30000 }, (err, stdout, stderr) => {
      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (err) {
        resolve({
          success: false,
          output: getErrorMessage(err) + (combined ? `\n${combined}` : ""),
        });
      } else {
        resolve({ success: true, output: combined });
      }
    });
  });
}

/**
 * Level2 실행기: healCommand를 spawn으로 실행하고 stdout/stderr를 콜백으로 스트리밍한다.
 * 시간이 걸리거나 진행 상황을 표시해야 하는 커맨드에 적합.
 */
export function spawnHealProcess(
  check: DoctorCheck,
  onStdout: (data: string) => void,
  onStderr: (data: string) => void,
): Promise<AutoFixResult> {
  return new Promise((resolve) => {
    if (!check.healCommand || check.healCommand.length === 0) {
      resolve({ success: false, output: "healCommand가 정의되지 않았습니다" });
      return;
    }

    const [cmd, ...args] = check.healCommand;
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        onStdout(chunk.toString());
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        onStderr(chunk.toString());
      });
    }

    child.on("close", (code) => {
      resolve({
        success: code === 0,
        output: `프로세스 종료 코드: ${code ?? "null"}`,
      });
    });

    child.on("error", (err: unknown) => {
      resolve({ success: false, output: getErrorMessage(err) });
    });
  });
}
