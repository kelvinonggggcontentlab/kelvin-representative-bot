import { describe, expect, it, vi } from "vitest";
import { logEvent } from "./observability";

describe("structured operational logging", () => {
  it("redacts credential and message-bearing fields", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logEvent("info", "test_event", { authorization: "secret", message: "private message", token: "secret" });
    const logged = String(spy.mock.calls[0]?.[0]);
    expect(logged).toContain("[REDACTED]");
    expect(logged).not.toContain("private message");
    spy.mockRestore();
  });
});
