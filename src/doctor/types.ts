export interface DoctorCheckResult {
  id: string;
  label: string;
  severity: 'error' | 'warning' | 'info';
  status: 'pass' | 'fail' | 'warn' | 'skip';
  detail: string;
  fixSteps: string[];
  autoFixCommand?: string;
  docsUrl?: string;
}

export interface DoctorCheckOptions {
  /** claudePing check 활성화 여부 (기본: false) */
  enableClaudePing?: boolean;
}

export type DoctorCheck = (opts?: DoctorCheckOptions) => Promise<DoctorCheckResult>;
