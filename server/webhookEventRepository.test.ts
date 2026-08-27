import { describe, expect, it } from "vitest";
import { SupabaseServiceError } from "./supabase";
import { isDuplicateWebhookClaim } from "./webhookEventRepository";

describe("webhook event claims", () => {
  it("recognizes the unique update-id conflict as an idempotent duplicate", () => {
    expect(isDuplicateWebhookClaim(new SupabaseServiceError(409, false, "kr_webhook_events"))).toBe(true);
    expect(isDuplicateWebhookClaim(new SupabaseServiceError(500, true, "kr_webhook_events"))).toBe(false);
  });
});
