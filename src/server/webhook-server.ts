import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { verifyWebhookSignature } from "./webhook-validator.js";
import { dispatchEvent, GitHubIssueEvent } from "./event-dispatcher.js";
import { getTriggerLabels } from "../safety/label-filter.js";
import { getLogger } from "../utils/logger.js";
import type { AQConfig } from "../types/config.js";
import type { JobStore } from "../queue/job-store.js";

const logger = getLogger();

export interface WebhookServerOptions {
  config: AQConfig;
  webhookSecret: string;
  port?: number;
  onPipelineTrigger: (issueNumber: number, repo: string, dependencies?: number[], triggerReason?: string) => void;
  store?: JobStore;  // for dependency validation
}

export function createWebhookApp(options: WebhookServerOptions): Hono {
  const app = new Hono();

  // GitHub webhook endpoint
  app.post("/webhook/github", async (c) => {
    const body = await c.req.text();
    const signature = c.req.header("X-Hub-Signature-256");
    const eventType = c.req.header("X-GitHub-Event") ?? "";
    const deliveryId = c.req.header("X-GitHub-Delivery") ?? "";

    // Verify signature
    if (!verifyWebhookSignature(body, signature, options.webhookSecret)) {
      logger.warn(`Invalid webhook signature (delivery: ${deliveryId})`);
      return c.json({ error: "Invalid signature" }, 401);
    }

    // Parse payload
    let payload: GitHubIssueEvent;
    try {
      payload = JSON.parse(body);
    } catch (error: unknown) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    // Dispatch
    const triggerLabels = getTriggerLabels(
      options.config.general.instanceLabel,
      options.config.safety.allowedLabels
    );
    const result = dispatchEvent(
      eventType,
      payload,
      triggerLabels,
      options.config,
      options.store
    );

    if (result.shouldProcess && result.issueNumber && result.repo) {
      options.onPipelineTrigger(result.issueNumber, result.repo, result.dependencies, result.reason);
      return c.json({
        status: "accepted",
        issueNumber: result.issueNumber,
        repo: result.repo,
      }, 202);
    }

    // 스킵 이벤트 기록 (이슈 번호가 식별 가능한 경우에만)
    if (options.store && result.reasonCode && payload.issue?.number && payload.repository?.full_name) {
      options.store.addSkipEvent(
        payload.issue.number,
        payload.repository.full_name,
        result.reasonCode,
        result.reason ?? result.reasonCode,
        "webhook"
      );
    }

    return c.json({ status: "ignored", reason: result.reason }, 200);
  });

  return app;
}

export function startServer(
  app: Hono,
  port: number = 3000,
  hostname: string = "127.0.0.1"
): { close: () => void } {
  let server: ReturnType<typeof serve>;
  try {
    server = serve({ fetch: app.fetch, port, hostname });
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      logger.warn(`포트 ${port}가 이미 사용 중입니다 (EADDRINUSE)`);
      throw new Error(`포트 ${port}가 이미 사용 중입니다. 다른 프로세스가 해당 포트를 점유하고 있습니다.`);
    }
    throw err;
  }
  logger.info(`AI Quartermaster server listening on ${hostname}:${port}`);
  return {
    close: () => {
      // @hono/node-server returns a Node http.Server
      (server as { close?: () => void }).close?.();
    },
  };
}
