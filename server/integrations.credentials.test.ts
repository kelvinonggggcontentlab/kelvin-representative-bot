import { describe, expect, it } from "vitest";

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("production integration credentials", () => {
  it("has a Telegram token and validates it with getMe", async () => {
    expect(telegramToken, "TELEGRAM_BOT_TOKEN must be configured").toMatch(/^\d+:[A-Za-z0-9_-]{20,}$/);

    const response = await fetch(`https://api.telegram.org/bot${telegramToken}/getMe`, {
      signal: AbortSignal.timeout(12_000),
    });
    const payload = (await response.json()) as { ok?: boolean; result?: { id?: number } };

    expect(response.ok).toBe(true);
    expect(payload.ok).toBe(true);
    expect(payload.result?.id).toEqual(expect.any(Number));
  }, 15_000);

  it("has a webhook verification secret with Telegram-compatible characters", () => {
    expect(webhookSecret, "TELEGRAM_WEBHOOK_SECRET must be configured").toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  });

  it("has Supabase server credentials and validates REST access", async () => {
    expect(supabaseUrl, "SUPABASE_URL must be configured").toMatch(/^https:\/\/.+\.supabase\.co(?:\/rest\/v1\/?)*$/);
    expect(supabaseServiceRoleKey, "SUPABASE_SERVICE_ROLE_KEY must be configured").toMatch(/^.+$/);

    const apiRoot = new URL(supabaseUrl!).origin;
    const response = await fetch(`${apiRoot}/rest/v1/nexus_memory?select=id&limit=1`, {
      headers: {
        apikey: supabaseServiceRoleKey!,
        Authorization: `Bearer ${supabaseServiceRoleKey!}`,
      },
      signal: AbortSignal.timeout(12_000),
    });

    expect(response.ok).toBe(true);
  }, 15_000);
});
