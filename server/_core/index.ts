import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { processTelegramUpdate } from "../botService";
import { checkTelegramReadiness, verifyTelegramWebhookSecret } from "../telegram";
import { checkSupabaseReadiness } from "../supabase";
import { createCorrelationId, logEvent, safeErrorSummary } from "../observability";
import { getConfigurationStatus, ENV } from "./env";
import { getUnsupportedUpdateReason, getUpdateMessage, isTelegramChatAllowed, parseTelegramUpdate } from "../telegramValidation";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use((req, res, next) => {
    const correlationId = createCorrelationId();
    res.setHeader("X-Request-Id", correlationId);
    res.locals.correlationId = correlationId;
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.get("/healthz", async (_req, res) => {
    const [database, telegram] = await Promise.all([checkSupabaseReadiness(), checkTelegramReadiness()]);
    const configuration = getConfigurationStatus();
    const ready = database && telegram && configuration.webhookSecret && configuration.externalTimeoutValid;
    return res.status(ready ? 200 : 503).json({ ok: ready, services: { database, telegram }, configuration: { webhookSecret: configuration.webhookSecret, externalTimeoutValid: configuration.externalTimeoutValid } });
  });
  app.post("/api/telegram/webhook", async (req, res) => {
    const correlationId = String(res.locals.correlationId);
    if (!verifyTelegramWebhookSecret(req.get("X-Telegram-Bot-Api-Secret-Token"))) {
      logEvent("warn", "telegram_webhook_rejected", { correlationId, reason: "invalid_secret" });
      return res.status(401).json({ ok: false, error: "Unverified Telegram webhook request." });
    }

    const parsedUpdate = parseTelegramUpdate(req.body);
    if (!parsedUpdate.success) {
      logEvent("warn", "telegram_webhook_rejected", { correlationId, reason: "invalid_payload" });
      return res.status(400).json({ ok: false, error: "Malformed Telegram update." });
    }
    const message = getUpdateMessage(parsedUpdate.data);
    const unsupportedReason = getUnsupportedUpdateReason(parsedUpdate.data);
    if (unsupportedReason) {
      logEvent("info", "telegram_webhook_ignored", { correlationId, updateId: parsedUpdate.data.update_id, reason: unsupportedReason });
      return res.status(200).json({ ok: true, status: "ignored" });
    }
    if (message && !isTelegramChatAllowed(message.chat.id)) {
      logEvent("warn", "telegram_webhook_ignored", { correlationId, updateId: parsedUpdate.data.update_id, reason: "chat_not_allowed" });
      return res.status(200).json({ ok: true, status: "ignored" });
    }

    try {
      const result = await processTelegramUpdate(parsedUpdate.data, correlationId);
      logEvent("info", "telegram_webhook_processed", { correlationId, updateId: parsedUpdate.data.update_id, status: result.status });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      logEvent("error", "telegram_webhook_failed", { correlationId, updateId: parsedUpdate.data.update_id, ...safeErrorSummary(error) });
      return res.status(500).json({ ok: false, error: "Webhook processing failed." });
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
