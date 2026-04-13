import { randomUUID } from "crypto";

/**
 * SessionManager — in-memory session token store.
 *
 * NOTE: This implementation is intentionally in-memory.
 * On server restart, all active sessions are invalidated — this is expected behavior.
 * Clients must re-authenticate after a server restart.
 */
export class SessionManager {
  /** token → expiry timestamp (ms) */
  private readonly tokens = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 60 * 60 * 1000 /* 1 hour */) {
    this.ttlMs = ttlMs;
  }

  /**
   * Issue a new session token.
   * Returns the token string and its TTL in milliseconds.
   */
  createToken(): { token: string; expiresIn: number } {
    this.pruneExpired();
    const token = randomUUID();
    this.tokens.set(token, Date.now() + this.ttlMs);
    return { token, expiresIn: this.ttlMs };
  }

  /**
   * Check whether a token is valid (exists and not expired).
   * Expired tokens are removed on access.
   */
  validate(token: string): boolean {
    const expiry = this.tokens.get(token);
    if (expiry === undefined) return false;
    if (Date.now() > expiry) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  /**
   * Revoke all active sessions.
   * Call this on graceful server shutdown.
   */
  revokeAll(): void {
    this.tokens.clear();
  }

  /**
   * Number of currently active (non-expired) sessions.
   * Used for operational monitoring.
   */
  getActiveCount(): number {
    this.pruneExpired();
    return this.tokens.size;
  }

  /**
   * Remove expired tokens from the store.
   * Called internally; also safe to call from a periodic cleanup interval.
   */
  pruneExpired(): void {
    const now = Date.now();
    for (const [token, expiry] of this.tokens) {
      if (now > expiry) this.tokens.delete(token);
    }
  }
}
