import { ENV } from "./_core/env";
import { generateReplyDecision, type ReplyDecision } from "./representative";
import { buildPendingAcknowledgement, getKelvinFastPathReply } from "./representativeProfile";
import { sendTelegramMessageWithReplyFallback } from "./telegram";
import { getOrCreateConversation as getOrCreateConversationRecord, getRecentMessages as getRecentConversationMessages, markInboundMessageStatus, recordInboundMessage, recordOutboundMessage } from "./conversationRepository";
import { claimWebhookEvent, markWebhookEvent } from "./webhookEventRepository";
import { createApprovalItem, expirePendingApprovals } from "./approvalRepository";
import { notifyOwnerOfApproval } from "./ownerNotificationService";
import { getBotSettingsRecord, type BotSettings } from "./ownerOperationsRepository";
import { getSafeTelegramCommandReply } from "./telegramValidation";

type TelegramIncomingMessage = {
  message_id: number;
  date: number;
  text?: string;
  chat: { id: number; type: "private" | "group" | "supergroup" | "channel"; title?: string };
  from?: { id: number; username?: string; first_name?: string; last_name?: string };
};

type TelegramUpdate = { update_id: number; message?: TelegramIncomingMessage; business_message?: TelegramIncomingMessage };
type Conversation = { id: string; telegram_chat_id: number; display_name: string | null };
type Approval = { id: string; conversation_id: string; inbound_message_id: string; draft_text: string; status: string };

export function shouldHoldReply(decision: ReplyDecision, settings: BotSettings): boolean {
  return decision.requiresApproval || !settings.auto_send_low_risk || !ENV.featureFlags.autoReplyEnabled;
}

export { buildPendingAcknowledgement, getKelvinFastPathReply } from "./representativeProfile";

async function updateWebhookEvent(updateId: number, values: Record<string, unknown>) {
  await markWebhookEvent(updateId, values);
}

async function expireStaleApprovals() {
  await expirePendingApprovals();
}

async function getOrCreateConversation(message: TelegramIncomingMessage) {
  return getOrCreateConversationRecord(message);
}

async function getRecentMessages(conversationId: string) {
  return getRecentConversationMessages(conversationId);
}

async function getBotSettings() {
  return getBotSettingsRecord();
}

async function createApproval(input: { conversationId: string; inboundMessageId: string; decision: ReplyDecision; holdReason?: string; correlationId?: string }) {
  return createApprovalItem(input);
}

async function notifyApproval(approval: Approval, decision: ReplyDecision, incomingText: string) {
  await notifyOwnerOfApproval(approval, decision, incomingText);
}

async function sendReply(input: { conversationId: string; chatId: number; replyToMessageId?: number; text: string; messageKind?: string; deliveryStatus?: string }) {
  const { sent, fallbackUsed } = await sendTelegramMessageWithReplyFallback(input.chatId, input.text, input.replyToMessageId);
  return recordOutboundMessage({ conversationId: input.conversationId, telegramMessageId: sent.message_id, text: input.text, messageKind: input.messageKind ?? "TEXT", replyToMessageId: input.replyToMessageId, fallbackUsed });
}

export async function processTelegramUpdate(update: TelegramUpdate, correlationId?: string) {
  if (await claimWebhookEvent({ updateId: update.update_id, payload: update, correlationId }) === "DUPLICATE") return { status: "duplicate" as const };
  try {
    const message = update.message ?? update.business_message;
    if (!message?.text?.trim()) {
      await updateWebhookEvent(update.update_id, { processing_status: "IGNORED", processed_at: new Date().toISOString() });
      return { status: "ignored" as const };
    }
    const conversation = await getOrCreateConversation(message);
    const inbound = await recordInboundMessage({ conversationId: conversation.id, updateId: update.update_id, message });
    const settings = await getBotSettings();
    await expireStaleApprovals();
    if (!settings.bot_enabled) {
      await updateWebhookEvent(update.update_id, { processing_status: "PROCESSED", processed_at: new Date().toISOString() });
      return { status: "recorded_bot_disabled" as const };
    }
    const commandReply = getSafeTelegramCommandReply(message.text);
    if (commandReply) {
      const outbound = await sendReply({ conversationId: conversation.id, chatId: conversation.telegram_chat_id, replyToMessageId: message.message_id, text: commandReply, messageKind: "COMMAND_ACKNOWLEDGEMENT" });
      await markInboundMessageStatus(inbound.id, "SENT");
      await updateWebhookEvent(update.update_id, { processing_status: "PROCESSED", processed_at: new Date().toISOString() });
      return { status: "sent" as const, outboundMessageId: outbound.id };
    }
    const fastPathReply = getKelvinFastPathReply(message.text);
    if (fastPathReply) {
      const outbound = await sendReply({ conversationId: conversation.id, chatId: conversation.telegram_chat_id, replyToMessageId: message.message_id, text: fastPathReply, messageKind: "CASUAL_FAST_PATH" });
      await markInboundMessageStatus(inbound.id, "SENT");
      await updateWebhookEvent(update.update_id, { processing_status: "PROCESSED", processed_at: new Date().toISOString() });
      return { status: "sent" as const, outboundMessageId: outbound.id };
    }
    const decision = await generateReplyDecision({ conversationId: conversation.id, incomingText: message.text.trim(), recentMessages: await getRecentMessages(conversation.id) });
    if (shouldHoldReply(decision, settings)) {
      const reason = decision.requiresApproval ? decision.holdReason : "Manual-review mode is active for low-risk drafts.";
      const approval = await createApproval({ conversationId: conversation.id, inboundMessageId: inbound.id, decision, holdReason: reason, correlationId });
      await sendReply({ conversationId: conversation.id, chatId: conversation.telegram_chat_id, replyToMessageId: message.message_id, text: buildPendingAcknowledgement(decision), messageKind: "PENDING_ACKNOWLEDGEMENT" });
      await markInboundMessageStatus(inbound.id, "HELD");
      await notifyApproval(approval, decision, message.text.trim());
      await updateWebhookEvent(update.update_id, { processing_status: "PROCESSED", processed_at: new Date().toISOString() });
      return { status: "held" as const, approvalId: approval.id };
    }
    const outbound = await sendReply({ conversationId: conversation.id, chatId: conversation.telegram_chat_id, replyToMessageId: message.message_id, text: decision.draftText, messageKind: "AUTO_REPLY" });
    await markInboundMessageStatus(inbound.id, "SENT");
    await updateWebhookEvent(update.update_id, { processing_status: "PROCESSED", processed_at: new Date().toISOString() });
    return { status: "sent" as const, outboundMessageId: outbound.id };
  } catch (error) {
    await updateWebhookEvent(update.update_id, { processing_status: "FAILED", error_message: error instanceof Error ? error.message.slice(0, 500) : "Unknown webhook processing error", processed_at: new Date().toISOString() }).catch(() => undefined);
    throw error;
  }
}
