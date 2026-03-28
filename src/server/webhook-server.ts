import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { verifyWebhookSignature } from "./webhook-validator.js";
import { dispatchEvent, GitHubIssueEvent } from "./event-dispatcher.js";
import { getLogger } from "../utils/logger.js";
import type { AQConfig } from "../types/config.js";

const logger = getLogger();

export interface WebhookServerOptions {
  config: AQConfig;
  webhookSecret: string;
  port?: number;
  onPipelineTrigger: (issueNumber: number, repo: string) => void;
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
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    // Dispatch
    const result = dispatchEvent(
      eventType,
      payload,
      options.config.safety.allowedLabels
    );

    if (result.shouldProcess && result.issueNumber && result.repo) {
      options.onPipelineTrigger(result.issueNumber, result.repo);
      return c.json({
        status: "accepted",
        issueNumber: result.issueNumber,
        repo: result.repo,
      }, 202);
    }

    return c.json({ status: "ignored", reason: result.reason }, 200);
  });

  return app;
}

export function startServer(
  app: Hono,
  port: number = 3000
): { close: () => void } {
  const server = serve({ fetch: app.fetch, port });
  logger.info(`AI 병참부 server listening on port ${port}`);
  return {
    close: () => {
      // @hono/node-server returns a Node http.Server
      (server as any).close?.();
    },
  };
}
