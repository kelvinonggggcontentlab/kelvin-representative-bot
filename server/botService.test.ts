import { describe, expect, it } from "vitest";
import { buildPendingAcknowledgement, shouldHoldReply } from "./botService";
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

  it("tells a held task requester that Kelvin will follow up after review", () => {
    const acknowledgement = buildPendingAcknowledgement({ ...lowRiskDecision, requiresApproval: true, riskLevel: "MEDIUM", riskCategories: ["TASK_REQUEST"] });
    expect(acknowledgement).toContain("sent to Kelvin for review");
    expect(acknowledgement).toContain("we’ll update you once there’s a decision");
  });

  it("uses a neutral pending acknowledgement for an enquiry", () => {
    const acknowledgement = buildPendingAcknowledgement({ ...lowRiskDecision, requiresApproval: true, riskLevel: "MEDIUM", riskCategories: ["ENQUIRY"] });
    expect(acknowledgement).toContain("enquiry has been sent to Kelvin for review");
    expect(acknowledgement).not.toContain("approved");
  });
});
