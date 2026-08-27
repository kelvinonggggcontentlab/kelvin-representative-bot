import { z } from "zod";
import { ENV } from "./_core/env";

const senderSchema = z.object({
  id: z.number().int(),
  username: z.string().max(128).optional(),
  first_name: z.string().max(256).optional(),
  last_name: z.string().max(256).optional(),
}).passthrough();

const chatSchema = z.object({
  id: z.number().int(),
  type: z.enum(["private", "group", "supergroup", "channel"]),
  title: z.string().max(256).optional(),
}).passthrough();

const incomingMessageSchema = z.object({
  message_id: z.number().int().nonnegative(),
  date: z.number().int().nonnegative(),
  text: z.string().max(4_096).optional(),
  chat: chatSchema,
  from: senderSchema.optional(),
}).passthrough();

export const telegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: incomingMessageSchema.optional(),
  business_message: incomingMessageSchema.optional(),
  callback_query: z.object({ id: z.string().min(1).max(128), from: senderSchema, data: z.string().max(256).optional() }).passthrough().optional(),
}).passthrough();

export type TelegramIncomingMessage = z.infer<typeof incomingMessageSchema>;
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export function parseTelegramUpdate(payload: unknown) {
  return telegramUpdateSchema.safeParse(payload);
}

export function getUpdateMessage(update: TelegramUpdate) {
  return update.message ?? update.business_message ?? null;
}

export function getUnsupportedUpdateReason(update: TelegramUpdate) {
  if (update.callback_query) return "unsupported_callback";
  return getUpdateMessage(update) ? null : "unsupported_update_type";
}

export function parseTelegramCommand(text: string) {
  const match = text.trim().match(/^\/([a-z0-9_]{1,32})(?:@[a-z0-9_]{3,64})?(?:\s|$)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function getSafeTelegramCommandReply(text: string) {
  const command = parseTelegramCommand(text);
  if (!command) return null;
  if (command === "start") return "ya, what happen?";
  return "just tell me what happen. I check from there.";
}

export function isTelegramChatAllowed(chatId: number) {
  return ENV.allowedTelegramChatIds.length === 0 || ENV.allowedTelegramChatIds.includes(String(chatId));
}
