import { describe, expect, it } from "vitest";
import { buildPendingAcknowledgement, getKelvinFastPathReply, shouldHoldReply } from "./botService";
import { canClaimApproval } from "./ownerOperationsService";
import type { ReplyDecision } from "./representative";

const lowRiskDecision: ReplyDecision = {
  draftText: "ok can",
  mode: "CASUAL",
  riskLevel: "LOW",
  riskCategories: [],
  requiresApproval: false,
  holdReason: "Low-risk context-aware draft.",
};

describe("approval dispatch safeguard", () => {
  it("holds a high-risk draft even when low-risk auto-send is enabled", () => {
    expect(shouldHoldReply({ ...lowRiskDecision, riskLevel: "HIGH", requiresApproval: true }, { auto_send_low_risk: true, bot_enabled: true })).toBe(true);
  });

  it("holds a low-risk draft while manual-review mode is active", () => {
    expect(shouldHoldReply(lowRiskDecision, { auto_send_low_risk: false, bot_enabled: true })).toBe(true);
  });

  it("only permits automatic delivery for an explicitly low-risk draft in auto-send mode", () => {
    expect(shouldHoldReply(lowRiskDecision, { auto_send_low_risk: true, bot_enabled: true })).toBe(false);
  });

  it("permits exactly a non-expired pending approval to enter the sending state", () => {
    const now = Date.now();
    expect(canClaimApproval("PENDING", new Date(now + 60_000).toISOString(), now)).toBe(true);
    expect(canClaimApproval("SEND_FAILED", new Date(now + 60_000).toISOString(), now)).toBe(true);
    expect(canClaimApproval("SENDING", new Date(now + 60_000).toISOString(), now)).toBe(false);
    expect(canClaimApproval("SENT", new Date(now + 60_000).toISOString(), now)).toBe(false);
    expect(canClaimApproval("PENDING", new Date(now - 60_000).toISOString(), now)).toBe(false);
  });

  it("never permits an expired or terminal decision to be delivered again", () => {
    const now = Date.now();
    ["SENDING", "SENT", "REJECTED", "EXPIRED"].forEach(status => {
      expect(canClaimApproval(status, new Date(now + 60_000).toISOString(), now)).toBe(false);
    });
  });

  it("tells a held task requester that Kelvin will follow up after review", () => {
    const acknowledgement = buildPendingAcknowledgement({ ...lowRiskDecision, requiresApproval: true, riskLevel: "MEDIUM", riskCategories: ["TASK_REQUEST"] });
    expect(acknowledgement).toBe("ok, I check this first.\n\nGot update I come back to you.");
  });

  it("uses a natural, non-corporate pending acknowledgement for an enquiry", () => {
    const acknowledgement = buildPendingAcknowledgement({ ...lowRiskDecision, requiresApproval: true, riskLevel: "MEDIUM", riskCategories: ["ENQUIRY"] });
    expect(acknowledgement).toBe("ok, I check first.\n\nGot update I let you know.");
    expect(acknowledgement).not.toMatch(/noted|enquiry|please bear|we.?ll get back/i);
  });

  it("replies to onboarding and a casual presence ping in Kelvin’s rhythm", () => {
    expect(getKelvinFastPathReply("/start")).toBe("ya, what happen?");
    expect(getKelvinFastPathReply("hey Kelvin, are u there?")).toBe("ya, what happen?");
    expect(getKelvinFastPathReply("Can you approve this proposal?")).toBeNull();
  });
});
