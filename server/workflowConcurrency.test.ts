import { describe, expect, it } from "vitest";
import { claimApprovalForSend } from "./approvalRepository";
import { SupabaseServiceError } from "./supabase";
import { claimWebhookEventWith } from "./webhookEventRepository";

describe("workflow concurrency boundaries", () => {
  it("allows exactly one concurrent workflow to claim a repeated Telegram update", async () => {
    let inserted = false;
    const insert = async () => {
      if (inserted) throw new SupabaseServiceError(409, false, "kr_webhook_events");
      inserted = true;
    };
    const results = await Promise.all([
      claimWebhookEventWith({ updateId: 1001, payload: { message: "one" } }, insert),
      claimWebhookEventWith({ updateId: 1001, payload: { message: "one" } }, insert),
    ]);
    expect(results.sort()).toEqual(["CLAIMED", "DUPLICATE"]);
  });

  it("allows exactly one concurrent owner action to claim an approval for sending", async () => {
    let claimed = false;
    const atomicClaim = async () => {
      if (claimed) return [];
      claimed = true;
      return [{ id: "approval-1", conversation_id: "conversation-1", inbound_message_id: "message-1", draft_text: "ok", status: "SENDING" }];
    };
    const [first, second] = await Promise.all([
      claimApprovalForSend({ approvalId: "approval-1", reviewer: "Kelvin" }, atomicClaim),
      claimApprovalForSend({ approvalId: "approval-1", reviewer: "Kelvin" }, atomicClaim),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter(result => result === null)).toHaveLength(1);
  });
});
