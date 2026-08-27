import { describe, expect, it } from "vitest";
import { TelegramApiError, sendTelegramMessageWithReplyFallback, verifyTelegramWebhookSecret } from "./telegram";

describe("Telegram webhook verification", () => {
  it("rejects missing or mismatched secret values", () => {
    expect(verifyTelegramWebhookSecret(undefined)).toBe(false);
    expect(verifyTelegramWebhookSecret("incorrect-secret")).toBe(false);
  });

  it("accepts the configured Telegram secret", () => {
    expect(verifyTelegramWebhookSecret(process.env.TELEGRAM_WEBHOOK_SECRET)).toBe(true);
  });

  it("sends once without a reply reference only when Telegram reports a stale reply target", async () => {
    const calls: Array<number | undefined> = [];
    const sender = async (_chatId: number | string, _text: string, replyTo?: number) => {
      calls.push(replyTo);
      if (replyTo) throw new TelegramApiError("sendMessage", 400, "Bad Request: message to be replied not found");
      return { message_id: 99, date: 1 };
    };
    const result = await sendTelegramMessageWithReplyFallback(123, "ok", 77, sender);
    expect(result).toEqual({ sent: { message_id: 99, date: 1 }, fallbackUsed: true });
    expect(calls).toEqual([77, undefined]);
  });

  it("does not silently retry unrelated Telegram failures", async () => {
    const sender = async () => { throw new TelegramApiError("sendMessage", 403, "Forbidden: bot was blocked"); };
    await expect(sendTelegramMessageWithReplyFallback(123, "ok", 77, sender)).rejects.toThrow("bot was blocked");
  });
});
