import { DoctorCheck, DoctorCheckOptions, DoctorCheckResult } from './types.js';

export { DoctorCheckResult, DoctorCheckOptions, DoctorCheck } from './types.js';

export async function runAllChecks(
  checks: DoctorCheck[],
  opts?: DoctorCheckOptions,
): Promise<DoctorCheckResult[]> {
  const results: DoctorCheckResult[] = [];
  for (const check of checks) {
    const result = await check(opts);
    results.push(result);
  }
  return results;
}
