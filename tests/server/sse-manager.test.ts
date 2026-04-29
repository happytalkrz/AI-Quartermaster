import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SSEManager } from "../../src/server/sse-manager.js";

function makeController() {
  return {
    enqueue: vi.fn(),
    close: vi.fn(),
    error: vi.fn(),
    desiredSize: 0,
    terminate: vi.fn(),
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
}

describe("SSEManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("addClient / clientCount / removeClient", () => {
    it("addClient는 ID를 반환하고 clientCount를 증가시킨다", () => {
      const m = new SSEManager();
      const id = m.addClient(makeController());
      expect(id).toBeTruthy();
      expect(m.clientCount).toBe(1);
    });

    it("외부 ID 주입 시 그대로 사용한다", () => {
      const m = new SSEManager();
      const id = m.addClient(makeController(), "external-id");
      expect(id).toBe("external-id");
    });

    it("removeClient는 컨트롤러 close + 맵에서 제거", () => {
      const m = new SSEManager();
      const ctrl = makeController();
      const id = m.addClient(ctrl, "abc");
      m.removeClient(id);
      expect(m.clientCount).toBe(0);
      expect(ctrl.close).toHaveBeenCalled();
    });

    it("존재하지 않는 클라이언트 removeClient는 무시", () => {
      const m = new SSEManager();
      expect(() => m.removeClient("nope")).not.toThrow();
    });

    it("close 예외는 무시되고 맵에서 제거된다", () => {
      const m = new SSEManager();
      const ctrl = makeController();
      (ctrl.close as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("already closed");
      });
      const id = m.addClient(ctrl);
      expect(() => m.removeClient(id)).not.toThrow();
      expect(m.clientCount).toBe(0);
    });
  });

  describe("maxClients enforcement", () => {
    it("한도 초과 시 가장 오래된 클라이언트를 evict한다", () => {
      const m = new SSEManager({ maxClients: 2 });
      const c1 = makeController();
      vi.setSystemTime(new Date("2026-04-26T00:00:00.000Z"));
      m.addClient(c1, "first");
      vi.setSystemTime(new Date("2026-04-26T00:00:01.000Z"));
      m.addClient(makeController(), "second");
      vi.setSystemTime(new Date("2026-04-26T00:00:02.000Z"));
      m.addClient(makeController(), "third");

      expect(m.clientCount).toBe(2);
      // oldest(first) should have been evicted
      expect(c1.close).toHaveBeenCalled();
    });
  });

  describe("broadcast", () => {
    it("모든 클라이언트에 SSE 메시지를 enqueue한다", () => {
      const m = new SSEManager();
      const c1 = makeController();
      const c2 = makeController();
      m.addClient(c1);
      m.addClient(c2);
      m.broadcast("jobUpdated", { id: 1 });

      expect(c1.enqueue).toHaveBeenCalledTimes(1);
      expect(c2.enqueue).toHaveBeenCalledTimes(1);

      const sent = (c1.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][0] as Uint8Array;
      const decoded = new TextDecoder().decode(sent);
      expect(decoded).toContain("event: jobUpdated");
      expect(decoded).toContain('"id":1');
    });

    it("enqueue 실패한 클라이언트는 풀에서 제거", () => {
      const m = new SSEManager();
      const c1 = makeController();
      (c1.enqueue as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("write failed");
      });
      m.addClient(c1, "broken");
      m.addClient(makeController(), "ok");

      m.broadcast("event", {});
      expect(m.clientCount).toBe(1);
    });

    it("clientTimeoutMs 초과한 클라이언트는 broadcast 시 제거", () => {
      const m = new SSEManager({ clientTimeoutMs: 1000 });
      vi.setSystemTime(new Date("2026-04-26T00:00:00.000Z"));
      m.addClient(makeController(), "stale");

      vi.setSystemTime(new Date("2026-04-26T00:00:02.000Z"));
      m.broadcast("event", {});
      expect(m.clientCount).toBe(0);
    });
  });

  describe("sendHeartbeat / removeStale", () => {
    it("sendHeartbeat은 heartbeat 이벤트를 모든 클라이언트에 보낸다", () => {
      const m = new SSEManager();
      const c1 = makeController();
      m.addClient(c1);
      m.sendHeartbeat();

      const sent = (c1.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][0] as Uint8Array;
      const decoded = new TextDecoder().decode(sent);
      expect(decoded).toContain("event: heartbeat");
    });

    it("removeStale은 timeout 초과 클라이언트만 제거", () => {
      const m = new SSEManager({ clientTimeoutMs: 1000 });
      vi.setSystemTime(new Date("2026-04-26T00:00:00.000Z"));
      m.addClient(makeController(), "old");
      vi.setSystemTime(new Date("2026-04-26T00:00:01.500Z"));
      m.addClient(makeController(), "fresh");

      // old: lastHeartbeat=0s, now=1.5s, timeout=1s → stale
      // fresh: lastHeartbeat=1.5s, now=1.5s → fresh
      m.removeStale();
      expect(m.clientCount).toBe(1);
    });
  });

  describe("startHeartbeat / stopHeartbeat", () => {
    it("startHeartbeat은 주기적으로 heartbeat을 송출한다", () => {
      const m = new SSEManager({ heartbeatMs: 100 });
      const c1 = makeController();
      m.addClient(c1);
      m.startHeartbeat();
      vi.advanceTimersByTime(350);
      // 100, 200, 300ms — 3회
      expect(c1.enqueue).toHaveBeenCalledTimes(3);
      m.stopHeartbeat();
    });

    it("startHeartbeat을 두 번 호출해도 interval이 누수되지 않는다", () => {
      const m = new SSEManager({ heartbeatMs: 100 });
      const c1 = makeController();
      m.addClient(c1);
      m.startHeartbeat();
      m.startHeartbeat(); // restart
      vi.advanceTimersByTime(150);
      // 첫 interval은 종료됐으니 1회만 발화
      expect(c1.enqueue).toHaveBeenCalledTimes(1);
      m.stopHeartbeat();
    });
  });

  describe("cleanupAll", () => {
    it("모든 컨트롤러를 close하고 맵을 비운다", () => {
      const m = new SSEManager();
      const c1 = makeController();
      const c2 = makeController();
      m.addClient(c1);
      m.addClient(c2);
      m.cleanupAll();

      expect(c1.close).toHaveBeenCalled();
      expect(c2.close).toHaveBeenCalled();
      expect(m.clientCount).toBe(0);
    });
  });
});
