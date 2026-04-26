import { randomUUID } from "crypto";

/**
 * SSE 클라이언트 1건의 메타.
 */
interface SSEClient {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  connectedAt: number;
  lastHeartbeat: number;
}

export interface SSEManagerOptions {
  /** 동시 연결 최대치. 기본 50. */
  maxClients?: number;
  /** Heartbeat 송출 주기 (ms). 기본 30s. */
  heartbeatMs?: number;
  /** 마지막 heartbeat 이후 이 시간이 지나면 stale로 간주 (ms). 기본 2m. */
  clientTimeoutMs?: number;
}

/**
 * SSE(Server-Sent Events) 클라이언트 풀 관리 + heartbeat 루프.
 *
 * 이전에는 `dashboard-api.ts` module-level 상태(Map<string, SSEClient> + interval)로 흩어져 있었다.
 * Plan C #C5 — 단일 클래스로 캡슐화하고 dashboard-api는 인스턴스 1개를 보유한다.
 *
 * 라이프사이클:
 *   addClient(controller) → broadcast/sendHeartbeat 발화 시 자동으로 stale 제거
 *   startHeartbeat() ↔ stopHeartbeat() — interval 토글
 *   cleanupAll() — 모든 컨트롤러 close + 맵 비움 (서버 종료 시)
 */
export class SSEManager {
  private readonly clients = new Map<string, SSEClient>();
  private readonly encoder = new TextEncoder();
  private readonly maxClients: number;
  private readonly heartbeatMs: number;
  private readonly clientTimeoutMs: number;
  private heartbeatInterval?: ReturnType<typeof setInterval>;

  constructor(opts: SSEManagerOptions = {}) {
    this.maxClients = opts.maxClients ?? 50;
    this.heartbeatMs = opts.heartbeatMs ?? 30_000;
    this.clientTimeoutMs = opts.clientTimeoutMs ?? 120_000;
  }

  /**
   * 새 클라이언트 등록. 한도 초과 시 가장 오래된 클라이언트를 evict한 후 추가한다.
   * @param controller ReadableStream 컨트롤러
   * @param id 클라이언트 식별자(미주입 시 randomUUID). 호출부가 stream cancel 핸들러에서
   *           동일 id로 removeClient를 호출할 수 있도록 외부에서 주입 가능.
   * @returns 등록된 클라이언트 ID
   */
  addClient(
    controller: ReadableStreamDefaultController<Uint8Array>,
    id: string = randomUUID()
  ): string {
    if (this.clients.size >= this.maxClients) {
      this.evictOldest(this.maxClients - 1);
    }
    const now = Date.now();
    this.clients.set(id, { id, controller, connectedAt: now, lastHeartbeat: now });
    return id;
  }

  /**
   * 클라이언트 제거. 컨트롤러 close 실패는 무시한다.
   */
  removeClient(id: string): void {
    const client = this.clients.get(id);
    if (!client) return;
    try {
      client.controller.close();
    } catch {
      // already closed
    }
    this.clients.delete(id);
  }

  /**
   * 모든 클라이언트에 SSE 이벤트 전송. 전송 실패 또는 stale 클라이언트는 즉시 제거.
   */
  broadcast(event: string, data: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [clientId, client] of this.clients) {
      if (now - client.lastHeartbeat > this.clientTimeoutMs) {
        toRemove.push(clientId);
        continue;
      }
      try {
        client.controller.enqueue(this.encoder.encode(message));
        client.lastHeartbeat = now;
      } catch {
        toRemove.push(clientId);
      }
    }

    for (const id of toRemove) {
      this.clients.delete(id);
    }
  }

  /**
   * 모든 클라이언트에 heartbeat 이벤트 송출. 실패한 컨트롤러는 제거.
   */
  sendHeartbeat(): void {
    const message = `event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`;
    const toRemove: string[] = [];

    for (const [clientId, client] of this.clients) {
      try {
        client.controller.enqueue(this.encoder.encode(message));
      } catch {
        toRemove.push(clientId);
      }
    }

    for (const id of toRemove) {
      this.clients.delete(id);
    }
  }

  /**
   * 마지막 heartbeat 이후 timeout이 지난 클라이언트를 제거한다.
   */
  removeStale(): void {
    const now = Date.now();
    const toRemove: string[] = [];
    for (const [clientId, client] of this.clients) {
      if (now - client.lastHeartbeat > this.clientTimeoutMs) {
        toRemove.push(clientId);
      }
    }
    for (const id of toRemove) {
      const client = this.clients.get(id);
      try {
        client?.controller.close();
      } catch {
        // ignore
      }
      this.clients.delete(id);
    }
  }

  /**
   * heartbeat interval 시작. 이미 켜져 있으면 먼저 정지 후 재시작.
   * 매 주기마다 sendHeartbeat + removeStale 호출.
   */
  startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
      this.removeStale();
    }, this.heartbeatMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  /**
   * 모든 클라이언트 컨트롤러 close + 맵 비움. 서버 종료 시 호출.
   */
  cleanupAll(): void {
    for (const [, client] of this.clients) {
      try {
        client.controller.close();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * 한도를 초과한 가장 오래된 클라이언트(connectedAt 기준)를 제거한다.
   */
  private evictOldest(targetCount: number): void {
    if (this.clients.size <= targetCount) return;
    const sorted = [...this.clients.entries()].sort(
      ([, a], [, b]) => a.connectedAt - b.connectedAt
    );
    const evictCount = this.clients.size - targetCount;
    for (let i = 0; i < evictCount; i++) {
      const [clientId, client] = sorted[i];
      try {
        client.controller.close();
      } catch {
        // ignore
      }
      this.clients.delete(clientId);
    }
  }
}
