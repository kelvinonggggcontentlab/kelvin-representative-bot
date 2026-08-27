import { describe, expect, it } from "vitest";
import { findDeterministicRiskSignals, partitionMemories } from "./representative";

describe("Kelvin Representative deterministic safety gate", () => {
  it("holds financial requests instead of allowing an autonomous commitment", () => {
    const result = findDeterministicRiskSignals("Can you transfer RM2,000 now? I promise I pay back.");
    expect(result.requiresApproval).toBe(true);
    expect(result.categories).toContain("FINANCIAL");
  });

  it("holds messages that require unverified current Kelvin context", () => {
    const result = findDeterministicRiskSignals("你几点来？你到底怎么想？");
    expect(result.requiresApproval).toBe(true);
    expect(result.uncertainty).toBe(true);
  });

  it("does not force a hold for ordinary low-risk logistics", () => {
    const result = findDeterministicRiskSignals("I reach in 10 minutes, can?");
    expect(result.requiresApproval).toBe(false);
    expect(result.categories).toEqual([]);
  });

  it("keeps archive context separate from live verified state", () => {
    const groups = partitionMemories([
      { memory_layer: "RELATIONSHIP", subject: "Context", statement: "Old record", source_type: "ARCHIVE", verification_status: "HISTORICAL", is_live_verified: false, observed_at: null },
      { memory_layer: "STATE", subject: "Boundary", statement: "Current instruction", source_type: "OWNER_OVERRIDE", verification_status: "CURRENT", is_live_verified: true, observed_at: null },
      { memory_layer: "FACT", subject: "Plan", statement: "Unconfirmed note", source_type: "LIVE_TELEGRAM", verification_status: "UNKNOWN", is_live_verified: false, observed_at: null },
    ]);

    expect(groups.archive).toHaveLength(1);
    expect(groups.live).toHaveLength(1);
    expect(groups.unverified).toHaveLength(1);
    expect(groups.live[0]?.statement).toBe("Current instruction");
  });
});
