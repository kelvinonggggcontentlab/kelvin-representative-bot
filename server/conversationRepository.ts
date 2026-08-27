import { supabaseHeaders, supabaseRequest } from "./supabase";
import type { TelegramIncomingMessage } from "./telegramValidation";

export type Conversation = { id: string; telegram_chat_id: number; display_name: string | null };
export type StoredMessage = { id: string; telegram_message_id: number | null; body: string | null; direction: string };

export async function getOrCreateConversation(message: TelegramIncomingMessage) {
  const displayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.chat.title || null;
  const rows = await supabaseRequest<Conversation[]>("kr_conversations?on_conflict=telegram_chat_id", { method: "POST", headers: supabaseHeaders.upsert, body: JSON.stringify({ telegram_chat_id: message.chat.id, telegram_user_id: message.from?.id ?? null, telegram_username: message.from?.username ?? null, display_name: displayName, updated_at: new Date().toISOString() }) });
  if (!rows[0]) throw new Error("Conversation upsert did not return a row.");
  return rows[0];
}

export async function recordInboundMessage(input: { conversationId: string; updateId: number; message: TelegramIncomingMessage }) {
  const rows = await supabaseRequest<StoredMessage[]>("kr_messages", { method: "POST", headers: supabaseHeaders.represent, body: JSON.stringify({ conversation_id: input.conversationId, telegram_update_id: input.updateId, telegram_message_id: input.message.message_id, direction: "INBOUND", message_kind: "TEXT", body: input.message.text?.trim() ?? null, raw_payload: input.message, delivery_status: "RECEIVED" }) });
  if (!rows[0]) throw new Error("Inbound message persistence did not return a row.");
  return rows[0];
}

export async function recordOutboundMessage(input: { conversationId: string; telegramMessageId: number; text: string; messageKind: string; replyToMessageId?: number; fallbackUsed?: boolean }) {
  const rows = await supabaseRequest<Array<{ id: string }>>("kr_messages", { method: "POST", headers: supabaseHeaders.represent, body: JSON.stringify({ conversation_id: input.conversationId, telegram_message_id: input.telegramMessageId, direction: "OUTBOUND", message_kind: input.messageKind, body: input.text, raw_payload: { message_id: input.telegramMessageId }, in_reply_to_telegram_message_id: input.fallbackUsed ? null : input.replyToMessageId ?? null, delivery_status: "SENT", sent_at: new Date().toISOString() }) });
  if (!rows[0]) throw new Error("Outbound message persistence did not return a row.");
  return rows[0];
}

export function markInboundMessageStatus(messageId: string, deliveryStatus: "SENT" | "HELD") {
  return supabaseRequest(`kr_messages?id=eq.${messageId}`, { method: "PATCH", headers: supabaseHeaders.represent, body: JSON.stringify({ delivery_status: deliveryStatus }) });
}

export async function getRecentMessages(conversationId: string) {
  const rows = await supabaseRequest<StoredMessage[]>(`kr_messages?conversation_id=eq.${conversationId}&select=direction,body&order=created_at.desc&limit=8`);
  return rows.reverse();
}
