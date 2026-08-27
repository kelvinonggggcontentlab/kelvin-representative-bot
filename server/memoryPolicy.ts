export type MemoryInputForValidation = {
  sourceType: "ARCHIVE" | "LIVE_TELEGRAM" | "OWNER_OVERRIDE" | "SYSTEM";
  verificationStatus: "OBSERVED" | "INFERRED" | "UNCERTAIN" | "CONFLICT" | "HISTORICAL" | "CURRENT" | "UNKNOWN";
  isLiveVerified: boolean;
  observedAt?: string;
};

export function validateMemoryTrustInvariant(memory: MemoryInputForValidation): string[] {
  const violations: string[] = [];
  if (memory.sourceType === "ARCHIVE" && (memory.isLiveVerified || memory.verificationStatus !== "HISTORICAL")) {
    violations.push("Archive memory must remain HISTORICAL and cannot be live verified.");
  }
  if (memory.verificationStatus === "CURRENT" && !memory.isLiveVerified) {
    violations.push("CURRENT memory must be explicitly live verified.");
  }
  if (memory.isLiveVerified && !["CURRENT", "OBSERVED"].includes(memory.verificationStatus)) {
    violations.push("Live verified memory must have CURRENT or OBSERVED verification status.");
  }
  if (memory.isLiveVerified && !["LIVE_TELEGRAM", "OWNER_OVERRIDE"].includes(memory.sourceType)) {
    violations.push("Only live Telegram or owner override memory may be live verified.");
  }
  if (memory.verificationStatus === "OBSERVED" && !memory.observedAt) {
    violations.push("OBSERVED memory requires an observation timestamp.");
  }
  return violations;
}
