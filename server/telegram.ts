import { timingSafeEqual } from "crypto";
import { ENV } from "./_core/env";
import { logEvent } from "./observability";

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export type TelegramSentMessage = {
  message_id: number;
  date: number;
};

export type TelegramWebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
};

export class TelegramApiError extends Error {
  constructor(public readonly method: string, public readonly status: number, public readonly description: string) {
    super(`Telegram ${method} failed (${status}): ${description}`);
    this.name = "TelegramApiError";
  }
}

async function telegramRequest<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!ENV.telegramBotToken) {
    throw new TelegramApiError(method, 0, "TELEGRAM_BOT_TOKEN is not configured.");
  }

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${ENV.telegramBotToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ENV.externalRequestTimeoutMs),
    });
  } catch (error) {
    throw new TelegramApiError(method, 0, error instanceof Error ? error.name : "Network error");
  }

  const result = await response.json().catch(() => ({ ok: false, description: "Invalid Telegram response." })) as TelegramApiResponse<T>;
  if (!response.ok || !result.ok || result.result === undefined) {
    throw new TelegramApiError(method, response.status, result.description ?? response.statusText);
  }
  return result.result;
}

export function verifyTelegramWebhookSecret(receivedSecret: string | undefined): boolean {
  if (!receivedSecret || !ENV.telegramWebhookSecret) return false;
  const received = Buffer.from(receivedSecret);
  const expected = Buffer.from(ENV.telegramWebhookSecret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function sendTelegramMessage(chatId: number | string, text: string, replyToMessageId?: number) {
  return telegramRequest<TelegramSentMessage>("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
  });
}

export async function sendTelegramMessageWithReplyFallback(chatId: number | string, text: string, replyToMessageId?: number, send: typeof sendTelegramMessage = sendTelegramMessage) {
  try {
    return { sent: await send(chatId, text, replyToMessageId), fallbackUsed: false };
  } catch (error) {
    const staleReplyTarget = error instanceof TelegramApiError && /message to be replied not found/i.test(error.description);
    if (!staleReplyTarget || !replyToMessageId) throw error;
    logEvent("warn", "telegram_reply_target_fallback", { method: "sendMessage", chatId: String(chatId) });
    return { sent: await send(chatId, text), fallbackUsed: true };
  }
}

export function setTelegramWebhook(webhookUrl: string) {
  return telegramRequest<boolean>("setWebhook", {
    url: webhookUrl,
    secret_token: ENV.telegramWebhookSecret,
    allowed_updates: ["message", "business_message"],
    drop_pending_updates: false,
  });
}

export function getTelegramWebhookInfo() {
  return telegramRequest<TelegramWebhookInfo>("getWebhookInfo");
}

export async function checkTelegramReadiness() {
  if (!ENV.telegramBotToken) return false;
  try {
    await telegramRequest<{ id: number }>("getMe");
    return true;
  } catch {
    return false;
  }
}
