import { describe, expect, it } from "vitest";
import { validateMemoryTrustInvariant } from "./memoryPolicy";

describe("memory trust invariants", () => {
  it("permits an explicit owner-confirmed current state", () => {
    expect(validateMemoryTrustInvariant({ sourceType: "OWNER_OVERRIDE", verificationStatus: "CURRENT", isLiveVerified: true })).toEqual([]);
  });

  it("rejects archive promotion to live state", () => {
    expect(validateMemoryTrustInvariant({ sourceType: "ARCHIVE", verificationStatus: "CURRENT", isLiveVerified: true })).toContain("Archive memory must remain HISTORICAL and cannot be live verified.");
  });

  it("requires a timestamp for observed evidence", () => {
    expect(validateMemoryTrustInvariant({ sourceType: "LIVE_TELEGRAM", verificationStatus: "OBSERVED", isLiveVerified: true })).toContain("OBSERVED memory requires an observation timestamp.");
  });
});
