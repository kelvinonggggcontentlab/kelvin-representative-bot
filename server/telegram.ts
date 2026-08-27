import { ENV } from "./_core/env";

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

async function telegramRequest<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!ENV.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const response = await fetch(`https://api.telegram.org/bot${ENV.telegramBotToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json()) as TelegramApiResponse<T>;

  if (!response.ok || !result.ok || result.result === undefined) {
    throw new Error(`Telegram ${method} failed: ${result.description ?? response.statusText}`);
  }

  return result.result;
}

export function verifyTelegramWebhookSecret(receivedSecret: string | undefined): boolean {
  return Boolean(receivedSecret && ENV.telegramWebhookSecret && receivedSecret === ENV.telegramWebhookSecret);
}

export function sendTelegramMessage(chatId: number | string, text: string, replyToMessageId?: number) {
  return telegramRequest<TelegramSentMessage>("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
  });
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
