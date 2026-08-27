import { describe, expect, it } from "vitest";
import { verifyTelegramWebhookSecret } from "./telegram";

describe("Telegram webhook verification", () => {
  it("rejects missing or mismatched secret values", () => {
    expect(verifyTelegramWebhookSecret(undefined)).toBe(false);
    expect(verifyTelegramWebhookSecret("incorrect-secret")).toBe(false);
  });

  it("accepts the configured Telegram secret", () => {
    expect(verifyTelegramWebhookSecret(process.env.TELEGRAM_WEBHOOK_SECRET)).toBe(true);
  });
});
