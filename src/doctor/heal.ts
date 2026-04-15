import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import type { ChildProcess } from 'child_process';
import { runAllChecks } from './checks.js';

const execAsync = promisify(exec);

/** Active Level2 heal process — one at a time globally */
let activeHealProcess: ChildProcess | null = null;

/**
 * Level1: Execute autoFixCommand for the given check and wait for completion.
 * Throws if the check is not found, has no autoFixCommand, or the command fails.
 */
export async function healLevel1(checkId: string): Promise<{ stdout: string; stderr: string }> {
  const checks = await runAllChecks();
  const check = checks.find(c => c.id === checkId);
  if (!check) {
    throw new Error(`Check '${checkId}' not found`);
  }
  if (!check.autoFixCommand) {
    throw new Error(`Check '${checkId}' has no autoFixCommand`);
  }
  const { stdout, stderr } = await execAsync(check.autoFixCommand, { timeout: 120_000 });
  return { stdout, stderr };
}

export interface HealL2Callbacks {
  onData: (chunk: string) => void;
  onDone: () => void;
  onFail: (msg: string) => void;
}

/**
 * Level2: Spawn autoFixCommand for the given check, streaming stdout/stderr via callbacks.
 * Replaces any currently running heal process.
 */
export function healLevel2(checkId: string, callbacks: HealL2Callbacks): void {
  runAllChecks()
    .then(checks => {
      const check = checks.find(c => c.id === checkId);
      if (!check?.autoFixCommand) {
        callbacks.onFail(`Check '${checkId}' has no autoFixCommand`);
        return;
      }

      if (activeHealProcess) {
        activeHealProcess.kill();
        activeHealProcess = null;
      }

      const proc = spawn(check.autoFixCommand, [], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      activeHealProcess = proc;

      proc.stdout?.on('data', (chunk: Buffer) => {
        callbacks.onData(chunk.toString());
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        callbacks.onData(chunk.toString());
      });

      proc.on('close', (code: number | null) => {
        activeHealProcess = null;
        if (code === 0) {
          callbacks.onDone();
        } else {
          callbacks.onFail(`Process exited with code ${code ?? 'unknown'}`);
        }
      });

      proc.on('error', (err: Error) => {
        activeHealProcess = null;
        callbacks.onFail(err.message);
      });
    })
    .catch((err: unknown) => {
      callbacks.onFail(err instanceof Error ? err.message : String(err));
    });
}

/**
 * Write a line of input to the active Level2 heal process stdin.
 * Returns true if written, false if no active process.
 */
export function writeToActiveHealProcess(input: string): boolean {
  if (!activeHealProcess?.stdin) return false;
  activeHealProcess.stdin.write(input + '\n');
  return true;
}
