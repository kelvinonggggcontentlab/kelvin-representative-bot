import { describe, expect, it } from "vitest";
import { getSafeTelegramCommandReply, getUnsupportedUpdateReason, parseTelegramCommand, parseTelegramUpdate } from "./telegramValidation";

describe("Telegram update validation", () => {
  it("accepts a supported text-message update", () => {
    const result = parseTelegramUpdate({ update_id: 10, message: { message_id: 3, date: 1_700_000_000, text: "ya?", chat: { id: 20, type: "private" }, from: { id: 20, first_name: "A" } } });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed update before it reaches orchestration", () => {
    const result = parseTelegramUpdate({ update_id: "not-an-integer", message: { chat: {} } });
    expect(result.success).toBe(false);
  });

  it("accepts an unknown Telegram update variant for safe acknowledgement", () => {
    const result = parseTelegramUpdate({ update_id: 11, edited_message: { message_id: 4 } });
    expect(result.success).toBe(true);
  });

  it("parses only bounded Telegram command syntax and marks callbacks unsupported", () => {
    expect(parseTelegramCommand("/start@kelvin_bot now")).toBe("start");
    expect(parseTelegramCommand("not a command")).toBeNull();
    const result = parseTelegramUpdate({ update_id: 12, callback_query: { id: "cb-1", from: { id: 9 } } });
    expect(result.success && getUnsupportedUpdateReason(result.data)).toBe("unsupported_callback");
  });

  it("executes no user-provided command and returns only safe bounded acknowledgements", () => {
    expect(getSafeTelegramCommandReply("/start")).toBe("ya, what happen?");
    expect(getSafeTelegramCommandReply("/admin_delete_everything")).toBe("just tell me what happen. I check from there.");
    expect(getSafeTelegramCommandReply("please /start now")).toBeNull();
  });
});
