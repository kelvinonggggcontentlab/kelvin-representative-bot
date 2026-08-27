import { ENV, getConfigurationStatus } from "./_core/env";
import { checkSupabaseReadiness, supabaseHeaders, supabaseRequest } from "./supabase";
import { checkTelegramReadiness, getTelegramWebhookInfo, sendTelegramMessageWithReplyFallback, setTelegramWebhook } from "./telegram";
import { recordOutboundMessage } from "./conversationRepository";
import { appendApprovalEvent, claimApprovalForSend, expirePendingApprovals, listApprovalEvents, listPendingOrFailedApprovals, type ApprovalEventType } from "./approvalRepository";
import { insertMemory, listMemoriesByConversation } from "./memoryRepository";
import { deactivateOverrideRecord, getBotSettingsRecord, getConversationMessageHistory, insertOverrideRecord, listConversationRecords, listOverrideRecords, updateBotSettingsRecord, type BotSettings } from "./ownerOperationsRepository";

type Conversation = { id: string; telegram_chat_id: number; display_name: string | null };
type StoredMessage = { id: string; telegram_message_id: number | null; body: string | null; direction: string };
type ApprovalQueueRow = {
  id: string;
  conversation_id: string;
  inbound_message_id: string;
  status: string;
  risk_level: string;
  risk_categories: string[];
  hold_reason: string;
  draft_text: string;
  created_at: string;
  expires_at: string | null;
};

export function canClaimApproval(status: string, expiresAt?: string | null, now = Date.now()) {
  return ["PENDING", "SEND_FAILED"].includes(status) && (!expiresAt || new Date(expiresAt).getTime() > now);
}

async function recordApprovalEvent(input: { approvalId: string; eventType: ApprovalEventType; actorType: "SYSTEM" | "OWNER"; actorId?: string; correlationId?: string; detail?: Record<string, unknown> }) {
  await appendApprovalEvent(input);
}

async function sendApprovedReply(input: { conversationId: string; chatId: number; replyToMessageId?: number; text: string }) {
  const { sent, fallbackUsed } = await sendTelegramMessageWithReplyFallback(input.chatId, input.text, input.replyToMessageId);
  return recordOutboundMessage({
    conversationId: input.conversationId,
    telegramMessageId: sent.message_id,
    text: input.text,
    messageKind: "APPROVED_FOLLOW_UP",
    replyToMessageId: input.replyToMessageId,
    fallbackUsed,
  });
}

export async function getOwnerApprovalQueue() {
  await expirePendingApprovals();
  const approvals = await listPendingOrFailedApprovals();
  return Promise.all(approvals.map(async approval => {
    const [conversation, inbound] = await Promise.all([
      supabaseRequest<Conversation[]>(`kr_conversations?id=eq.${approval.conversation_id}&select=id,telegram_chat_id,display_name,telegram_username,current_mode,relationship_state&limit=1`),
      supabaseRequest<StoredMessage[]>(`kr_messages?id=eq.${approval.inbound_message_id}&select=id,telegram_message_id,body,direction,created_at&limit=1`),
    ]);
    return { ...approval as ApprovalQueueRow, conversation: conversation[0] ?? null, inboundMessage: inbound[0] ?? null };
  }));
}

export async function approveOwnerReply(input: { approvalId: string; reviewer: string; editedText?: string; reviewerNote?: string }) {
  const approval = await claimApprovalForSend(input);
  if (!approval) throw new Error("This approval is no longer pending or has expired.");
  await recordApprovalEvent({ approvalId: input.approvalId, eventType: "CLAIMED", actorType: "OWNER", actorId: input.reviewer, detail: { edited: Boolean(input.editedText?.trim()) } });

  try {
    const [conversationRows, inboundRows] = await Promise.all([
      supabaseRequest<Conversation[]>(`kr_conversations?id=eq.${approval.conversation_id}&select=id,telegram_chat_id&limit=1`),
      supabaseRequest<StoredMessage[]>(`kr_messages?id=eq.${approval.inbound_message_id}&select=telegram_message_id&limit=1`),
    ]);
    const conversation = conversationRows[0];
    if (!conversation) throw new Error("Conversation not found for approval.");
    const text = String(input.editedText?.trim() || approval.draft_text || "");
    if (!text) throw new Error("An approval requires a reply draft.");
    const outbound = await sendApprovedReply({ conversationId: conversation.id, chatId: conversation.telegram_chat_id, replyToMessageId: inboundRows[0]?.telegram_message_id ?? undefined, text });
    await supabaseRequest(`kr_approval_items?id=eq.${input.approvalId}`, { method: "PATCH", headers: supabaseHeaders.represent, body: JSON.stringify({ status: "SENT", outbound_message_id: outbound.id, finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    await recordApprovalEvent({ approvalId: input.approvalId, eventType: "SENT", actorType: "OWNER", actorId: input.reviewer, detail: { outboundMessageId: outbound.id } });
    return { success: true, outboundMessageId: outbound.id };
  } catch (error) {
    await supabaseRequest(`kr_approval_items?id=eq.${input.approvalId}`, { method: "PATCH", headers: supabaseHeaders.represent, body: JSON.stringify({ status: "SEND_FAILED", reviewer_note: error instanceof Error ? error.message.slice(0, 500) : "Send failed", finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }).catch(() => undefined);
    await recordApprovalEvent({ approvalId: input.approvalId, eventType: "SEND_FAILED", actorType: "OWNER", actorId: input.reviewer, detail: { errorType: error instanceof Error ? error.name : "UnknownError" } }).catch(() => undefined);
    throw error;
  }
}

export async function rejectOwnerReply(input: { approvalId: string; reviewer: string; reviewerNote?: string }) {
  const now = new Date().toISOString();
  const rows = await supabaseRequest<Array<{ id: string }>>(`kr_approval_items?id=eq.${input.approvalId}&status=eq.PENDING`, { method: "PATCH", headers: supabaseHeaders.represent, body: JSON.stringify({ status: "REJECTED", reviewer_note: input.reviewerNote?.trim() || null, reviewed_by: input.reviewer, reviewed_at: now, finalized_at: now, updated_at: now }) });
  if (!rows[0]) throw new Error("This approval is no longer pending.");
  await recordApprovalEvent({ approvalId: input.approvalId, eventType: "REJECTED", actorType: "OWNER", actorId: input.reviewer });
  return { success: true };
}

export async function getOwnerConsoleStatus() {
  const [settings, webhookEvents, failedApprovals, database, telegram] = await Promise.all([
    getBotSettingsRecord(),
    supabaseRequest<Array<{ processing_status: string; received_at: string }>>("kr_webhook_events?select=processing_status,received_at&order=received_at.desc&limit=1"),
    supabaseRequest<Array<{ id: string }>>("kr_approval_items?status=eq.SEND_FAILED&select=id&limit=100"),
    checkSupabaseReadiness(),
    checkTelegramReadiness(),
  ]);
  const webhook = ENV.telegramBotToken ? await getTelegramWebhookInfo().catch(error => ({ error: error instanceof Error ? error.message : "Webhook status unavailable" })) : { error: "Telegram token is not configured." };
  const configuration = getConfigurationStatus();
  return {
    settings,
    credentials: { telegramToken: configuration.telegram, webhookSecret: configuration.webhookSecret, supabase: configuration.supabase, ownerNotification: configuration.ownerNotification },
    webhook,
    health: { ready: database && telegram && configuration.webhookSecret && configuration.externalTimeoutValid, database, telegram, externalTimeoutValid: configuration.externalTimeoutValid, failedApprovalCount: failedApprovals.length },
    latestWebhookEventStatus: webhookEvents[0]?.processing_status ?? "NO_EVENTS",
    latestWebhookEventAt: webhookEvents[0]?.received_at ?? null,
  };
}

export function getOwnerApprovalEvents(approvalId: string) { return listApprovalEvents(approvalId); }
export async function registerOwnerWebhook(webhookUrl: string) { await setTelegramWebhook(webhookUrl); return getOwnerConsoleStatus(); }
export function updateOwnerBotSettings(values: Partial<BotSettings>, updatedBy: string) { return updateBotSettingsRecord(values, updatedBy); }
export function listOwnerConversations() { return listConversationRecords(); }
export function getOwnerConversationHistory(conversationId: string) { return getConversationMessageHistory(conversationId); }
export function listOwnerMemories(conversationId?: string) { return listMemoriesByConversation(conversationId); }
export function listOwnerOverrides() { return listOverrideRecords(); }
export function createOwnerOverride(input: { scope: "GLOBAL" | "CONVERSATION"; conversationId?: string; instruction: string; createdBy: string; effectiveUntil?: string }) { return insertOverrideRecord(input); }
export function deactivateOwnerOverride(overrideId: string) { return deactivateOverrideRecord(overrideId); }
export function createOwnerMemory(input: Record<string, unknown>) { return insertMemory(input); }
