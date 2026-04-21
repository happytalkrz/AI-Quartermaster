import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

export interface PatternEntry {
  id: string;
  timestamp: string;
  issueNumber: number;
  repo: string;
  type: "success" | "failure";
  errorCategory?: string;
  errorMessage?: string;
  phaseName?: string;
  resolution?: string;
  tags: string[];
}

const MAX_ENTRIES = 100;
const MAX_PROMPT_CHARS = 500;

export class PatternStore {
  private filePath: string;

  constructor(private dataDir: string) {
    this.filePath = resolve(dataDir, "patterns.json");
    mkdirSync(dataDir, { recursive: true });
  }

  private load(): PatternEntry[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8")) as PatternEntry[];
    } catch (err: unknown) {
      void err;
      return [];
    }
  }

  private save(entries: PatternEntry[]): void {
    writeFileSync(this.filePath, JSON.stringify(entries, null, 2));
  }

  add(entry: Omit<PatternEntry, "id" | "timestamp">): PatternEntry {
    const entries = this.load();
    const newEntry: PatternEntry = {
      ...entry,
      id: `pat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      errorMessage: entry.errorMessage ? entry.errorMessage.slice(0, 200) : undefined,
    };
    entries.unshift(newEntry);
    // FIFO rotation: keep only the latest MAX_ENTRIES
    if (entries.length > MAX_ENTRIES) {
      entries.splice(MAX_ENTRIES);
    }
    this.save(entries);
    return newEntry;
  }

  list(filter?: { type?: string; repo?: string; limit?: number }): PatternEntry[] {
    let entries = this.load();
    if (filter?.type) {
      entries = entries.filter(e => e.type === filter.type);
    }
    if (filter?.repo) {
      entries = entries.filter(e => e.repo === filter.repo);
    }
    if (filter?.limit) {
      entries = entries.slice(0, filter.limit);
    }
    return entries;
  }

  getRecentFailures(repo: string, limit = 5): PatternEntry[] {
    return this.list({ type: "failure", repo, limit });
  }

  getStats(repo?: string): {
    total: number;
    successes: number;
    failures: number;
    byCategory: Record<string, number>;
    avgDurationMs?: number;
  } {
    const entries = repo ? this.list({ repo }) : this.load();
    const successes = entries.filter(e => e.type === "success").length;
    const failures = entries.filter(e => e.type === "failure").length;
    const byCategory: Record<string, number> = {};
    for (const e of entries) {
      if (e.type === "failure" && e.errorCategory) {
        byCategory[e.errorCategory] = (byCategory[e.errorCategory] ?? 0) + 1;
      }
    }
    return { total: entries.length, successes, failures, byCategory };
  }

  formatForPrompt(entries: PatternEntry[]): string {
    if (entries.length === 0) return "";
    const lines: string[] = ["## 과거 실패 사례 (참고)"];
    for (const e of entries) {
      const category = e.errorCategory ?? "UNKNOWN";
      const msg = e.errorMessage ? `"${e.errorMessage}"` : "(details unavailable)";
      const hint = e.resolution ? ` — ${e.resolution}` : resolutionHint(category);
      lines.push(`- ${category}: ${msg}${hint}`);
    }
    const result = lines.join("\n");
    return result.length > MAX_PROMPT_CHARS ? result.slice(0, MAX_PROMPT_CHARS) + "…" : result;
  }
}

const patternStoreCache = new Map<string, PatternStore>();

/**
 * 같은 dataDir에 대해 프로세스 수명 동안 단일 PatternStore 인스턴스를 반환한다.
 *
 * pipeline-phases / pipeline-publish / core-loop 등에서 각자 `new PatternStore()`를 생성하던
 * 5곳을 이 팩토리로 일원화해, 같은 파일을 가리키는 중복 인스턴스와 불필요한 `mkdirSync` 재호출을
 * 제거한다. 현재 모든 메서드가 동기 + write 경로가 단순한 read-modify-write라 단일 프로세스 내
 * race는 발생하지 않지만, 향후 async/캐싱 도입 시 단일 인스턴스 전제를 깔아두기 위함.
 */
export function getPatternStore(dataDir: string): PatternStore {
  const key = resolve(dataDir);
  let instance = patternStoreCache.get(key);
  if (!instance) {
    instance = new PatternStore(dataDir);
    patternStoreCache.set(key, instance);
  }
  return instance;
}

/** 테스트용 캐시 초기화. 프로덕션 코드에서는 사용하지 않음. */
export function __resetPatternStoreCacheForTests(): void {
  patternStoreCache.clear();
}

function resolutionHint(category: string): string {
  switch (category) {
    case "TS_ERROR":
      return " — import 누락이 원인. 사용 전 import 확인.";
    case "VERIFICATION_FAILED":
      return " — 기존 테스트 깨뜨리지 않도록 주의.";
    case "CLI_CRASH":
      return " — 명령어 경로 및 환경 확인.";
    case "TIMEOUT":
      return " — 장시간 작업 분리 고려.";
    case "SAFETY_VIOLATION":
      return " — 민감 경로 수정 금지.";
    default:
      return "";
  }
}
