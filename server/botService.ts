import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";
import { generateReplyDecision, type ReplyDecision } from "./representative";
import { supabaseHeaders, supabaseRequest } from "./supabase";
import { getTelegramWebhookInfo, sendTelegramMessage, setTelegramWebhook } from "./telegram";

type TelegramIncomingMessage = {
  message_id: number;
  date: number;
  text?: string;
  chat: { id: number; type: string; title?: string };
  from?: { id: number; username?: string; first_name?: string; last_name?: string };
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramIncomingMessage;
  business_message?: TelegramIncomingMessage;
};

type Conversation = { id: string; telegram_chat_id: number; display_name: string | null };
type StoredMessage = { id: string; telegram_message_id: number | null; body: string | null; direction: string };
type BotSettings = { auto_send_low_risk: boolean; bot_enabled: boolean };
type Approval = { id: string; conversation_id: string; inbound_message_id: string; draft_text: string; status: string };

export function shouldHoldReply(decision: ReplyDecision, settings: BotSettings): boolean {
  return decision.requiresApproval || !settings.auto_send_low_risk;
}

async function updateWebhookEvent(updateId: number, values: Record<string, unknown>) {
  await supabaseRequest(`kr_webhook_events?telegram_update_id=eq.${updateId}`, {
    method: "PATCH",
    headers: supabaseHeaders.represent,
    body: JSON.stringify(values),
  });
}

async function getOrCreateConversation(message: TelegramIncomingMessage) {
  const displayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.chat.title || null;
  const rows = await supabaseRequest<Conversation[]>("kr_conversations?on_conflict=telegram_chat_id", {
    method: "POST",
    headers: supabaseHeaders.upsert,
    body: JSON.stringify({
      telegram_chat_id: message.chat.id,
      telegram_user_id: message.from?.id ?? null,
      telegram_username: message.from?.username ?? null,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!rows[0]) throw new Error("Conversation upsert did not return a row.");
  return rows[0];
}

async function getRecentMessages(conversationId: string) {
  const rows = await supabaseRequest<StoredMessage[]>(
    `kr_messages?conversation_id=eq.${conversationId}&select=direction,body&order=created_at.desc&limit=8`
  );
  return rows.reverse();
}

async function getBotSettings() {
  const rows = await supabaseRequest<BotSettings[]>("kr_bot_settings?id=eq.true&select=auto_send_low_risk,bot_enabled&limit=1");
  return rows[0] ?? { auto_send_low_risk: false, bot_enabled: true };
}

async function createApproval(input: { conversationId: string; inboundMessageId: string; decision: ReplyDecision; holdReason?: string }) {
  const rows = await supabaseRequest<Approval[]>("kr_approval_items", {
    method: "POST",
    headers: supabaseHeaders.represent,
    body: JSON.stringify({
      conversation_id: input.conversationId,
      inbound_message_id: input.inboundMessageId,
      risk_level: input.decision.riskLevel,
      risk_categories: input.decision.riskCategories,
      hold_reason: input.holdReason ?? input.decision.holdReason,
      draft_text: input.decision.draftText,
    }),
  });
  if (!rows[0]) throw new Error("Approval item creation did not return a row.");
  return rows[0];
}

async function notifyApproval(approval: Approval, decision: ReplyDecision, incomingText: string) {
  const summary = `Risk: ${decision.riskLevel}. ${decision.holdReason}\n\nIncoming: ${incomingText.slice(0, 400)}\n\nDraft: ${decision.draftText}`;
  await notifyOwner({ title: "Kelvin Representative: approval required", content: summary }).catch(() => false);

  const notificationRows = await supabaseRequest<Array<{ id: string }>>("kr_owner_notifications", {
    method: "POST",
    headers: supabaseHeaders.represent,
    body: JSON.stringify({ approval_item_id: approval.id, channel: "TELEGRAM_OWNER", status: ENV.telegramOwnerChatId ? "PENDING" : "SKIPPED" }),
  });

  if (!ENV.telegramOwnerChatId || !notificationRows[0]) return;

  try {
    const sent = await sendTelegramMessage(ENV.telegramOwnerChatId, `REVIEW REQUIRED\n\n${summary}`);
    await supabaseRequest(`kr_owner_notifications?id=eq.${notificationRows[0].id}`, {
      method: "PATCH",
      headers: supabaseHeaders.represent,
      body: JSON.stringify({ status: "SENT", external_message_id: sent.message_id, sent_at: new Date().toISOString() }),
    });
  } catch (error) {
    await supabaseRequest(`kr_owner_notifications?id=eq.${notificationRows[0].id}`, {
      method: "PATCH",
      headers: supabaseHeaders.represent,
      body: JSON.stringify({ status: "FAILED", error_message: error instanceof Error ? error.message.slice(0, 500) : "Unknown notification error" }),
    });
  }
}

async function sendReply(input: { conversationId: string; chatId: number; replyToMessageId?: number; text: string }) {
  const sent = await sendTelegramMessage(input.chatId, input.text, input.replyToMessageId);
  const rows = await supabaseRequest<Array<{ id: string }>>("kr_messages", {
    method: "POST",
    headers: supabaseHeaders.represent,
    body: JSON.stringify({
      conversation_id: input.conversationId,
      telegram_message_id: sent.message_id,
      direction: "OUTBOUND",
      message_kind: "TEXT",
      body: input.text,
      raw_payload: sent,
      in_reply_to_telegram_message_id: input.replyToMessageId ?? null,
      delivery_status: "SENT",
      sent_at: new Date().toISOString(),
    }),
  });
  if (!rows[0]) throw new Error("Outbound message persistence did not return a row.");
  return rows[0];
}

export async function processTelegramUpdate(update: TelegramUpdate) {
  const existing = await supabaseRequest<Array<{ id: string }>>(
    `kr_webhook_events?telegram_update_id=eq.${update.update_id}&select=id&limit=1`
  );
  if (existing.length) return { status: "duplicate" as const };

  await supabaseRequest("kr_webhook_events", {
    method: "POST",
    body: JSON.stringify({ telegram_update_id: update.update_id, verified: true, payload: update, processing_status: "PROCESSING" }),
  });

  try {
    const message = update.message ?? update.business_message;
    if (!message?.text?.trim()) {
      await updateWebhookEvent(update.update_id, { processing_status: "IGNORED", processed_at: new Date().toISOString() });
      return { status: "ignored" as const };
    }

    const conversation = await getOrCreateConversation(message);
    const inboundRows = await supabaseRequest<StoredMessage[]>("kr_messages", {
      method: "POST",
      headers: supabaseHeaders.represent,
      body: JSON.stringify({
        conversation_id: conversation.id,
        telegram_update_id: update.update_id,
        telegram_message_id: message.message_id,
        direction: "INBOUND",
        message_kind: "TEXT",
        body: message.text.trim(),
        raw_payload: message,
        delivery_status: "RECEIVED",
      }),
    });
    if (!inboundRows[0]) throw new Error("Inbound message persistence did not return a row.");

    const settings = await getBotSettings();
    if (!settings.bot_enabled) {
      await updateWebhookEvent(update.update_id, { processing_status: "PROCESSED", processed_at: new Date().toISOString() });
      return { status: "recorded_bot_disabled" as const };
    }

    const decision = await generateReplyDecision({
      conversationId: conversation.id,
      incomingText: message.text.trim(),
      recentMessages: await getRecentMessages(conversation.id),
    });

    if (shouldHoldReply(decision, settings)) {
      const reason = decision.requiresApproval ? decision.holdReason : "Manual-review mode is active for low-risk drafts.";
      const approval = await createApproval({ conversationId: conversation.id, inboundMessageId: inboundRows[0].id, decision, holdReason: reason });
      await supabaseRequest(`kr_messages?id=eq.${inboundRows[0].id}`, {
        method: "PATCH",
        headers: supabaseHeaders.represent,
        body: JSON.stringify({ delivery_status: "HELD" }),
      });
      await notifyApproval(approval, decision, message.text.trim());
      await updateWebhookEvent(update.update_id, { processing_status: "PROCESSED", processed_at: new Date().toISOString() });
      return { status: "held" as const, approvalId: approval.id };
    }

    const outbound = await sendReply({
      conversationId: conversation.id,
      chatId: conversation.telegram_chat_id,
      replyToMessageId: message.message_id,
      text: decision.draftText,
    });
    await supabaseRequest(`kr_messages?id=eq.${inboundRows[0].id}`, {
      method: "PATCH",
      headers: supabaseHeaders.represent,
      body: JSON.stringify({ delivery_status: "SENT" }),
    });
    await updateWebhookEvent(update.update_id, { processing_status: "PROCESSED", processed_at: new Date().toISOString() });
    return { status: "sent" as const, outboundMessageId: outbound.id };
  } catch (error) {
    await updateWebhookEvent(update.update_id, {
      processing_status: "FAILED",
      error_message: error instanceof Error ? error.message.slice(0, 1_000) : "Unknown webhook processing error",
      processed_at: new Date().toISOString(),
    }).catch(() => undefined);
    throw error;
  }
}

export async function getApprovalQueue() {
  const approvals = await supabaseRequest<Array<Record<string, unknown>>>("kr_approval_items?status=eq.PENDING&order=created_at.desc&limit=50");
  return Promise.all(approvals.map(async approval => {
    const [conversation, inbound] = await Promise.all([
      supabaseRequest<Conversation[]>(`kr_conversations?id=eq.${approval.conversation_id}&select=id,telegram_chat_id,display_name,telegram_username,current_mode,relationship_state&limit=1`),
      supabaseRequest<StoredMessage[]>(`kr_messages?id=eq.${approval.inbound_message_id}&select=id,telegram_message_id,body,direction,created_at&limit=1`),
    ]);
    return { ...approval, conversation: conversation[0] ?? null, inboundMessage: inbound[0] ?? null };
  }));
}

export async function approveReply(input: { approvalId: string; reviewer: string; editedText?: string; reviewerNote?: string }) {
  const claimed = await supabaseRequest<Array<Record<string, unknown>>>(`kr_approval_items?id=eq.${input.approvalId}&status=eq.PENDING`, {
    method: "PATCH",
    headers: supabaseHeaders.represent,
    body: JSON.stringify({
      status: "APPROVED",
      edited_text: input.editedText?.trim() || null,
      reviewer_note: input.reviewerNote?.trim() || null,
      reviewed_by: input.reviewer,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  const approval = claimed[0];
  if (!approval) throw new Error("This approval is no longer pending.");

  const [conversationRows, inboundRows] = await Promise.all([
    supabaseRequest<Conversation[]>(`kr_conversations?id=eq.${approval.conversation_id}&select=id,telegram_chat_id&limit=1`),
    supabaseRequest<StoredMessage[]>(`kr_messages?id=eq.${approval.inbound_message_id}&select=telegram_message_id&limit=1`),
  ]);
  const conversation = conversationRows[0];
  const inbound = inboundRows[0];
  if (!conversation) throw new Error("Conversation not found for approval.");

  try {
    const text = String(input.editedText?.trim() || approval.draft_text || "");
    if (!text) throw new Error("An approval requires a reply draft.");
    const outbound = await sendReply({
      conversationId: conversation.id,
      chatId: conversation.telegram_chat_id,
      replyToMessageId: inbound?.telegram_message_id ?? undefined,
      text,
    });
    await supabaseRequest(`kr_approval_items?id=eq.${input.approvalId}`, {
      method: "PATCH",
      headers: supabaseHeaders.represent,
      body: JSON.stringify({ outbound_message_id: outbound.id, updated_at: new Date().toISOString() }),
    });
    return { success: true, outboundMessageId: outbound.id };
  } catch (error) {
    await supabaseRequest(`kr_approval_items?id=eq.${input.approvalId}`, {
      method: "PATCH",
      headers: supabaseHeaders.represent,
      body: JSON.stringify({ status: "SEND_FAILED", reviewer_note: error instanceof Error ? error.message.slice(0, 500) : "Send failed", updated_at: new Date().toISOString() }),
    });
    throw error;
  }
}

export async function rejectReply(input: { approvalId: string; reviewer: string; reviewerNote?: string }) {
  const rows = await supabaseRequest<Array<{ id: string }>>(`kr_approval_items?id=eq.${input.approvalId}&status=eq.PENDING`, {
    method: "PATCH",
    headers: supabaseHeaders.represent,
    body: JSON.stringify({ status: "REJECTED", reviewer_note: input.reviewerNote?.trim() || null, reviewed_by: input.reviewer, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
  if (!rows[0]) throw new Error("This approval is no longer pending.");
  return { success: true };
}

export async function getOwnerConsoleStatus() {
  const [settings, webhookEvents] = await Promise.all([
    getBotSettings(),
    supabaseRequest<Array<{ processing_status: string }>>("kr_webhook_events?select=processing_status&order=received_at.desc&limit=1"),
  ]);
  const webhook = ENV.telegramBotToken ? await getTelegramWebhookInfo().catch(error => ({ error: error instanceof Error ? error.message : "Webhook status unavailable" })) : { error: "Telegram token is not configured." };
  return {
    settings,
    credentials: {
      telegramToken: Boolean(ENV.telegramBotToken),
      webhookSecret: Boolean(ENV.telegramWebhookSecret),
      supabase: Boolean(ENV.supabaseUrl && ENV.supabaseServiceRoleKey),
      ownerNotification: Boolean(ENV.telegramOwnerChatId),
    },
    webhook,
    latestWebhookEventStatus: webhookEvents[0]?.processing_status ?? "NO_EVENTS",
  };
}

export async function registerWebhook(webhookUrl: string) {
  await setTelegramWebhook(webhookUrl);
  return getOwnerConsoleStatus();
}

export async function updateBotSettings(values: Partial<BotSettings>, updatedBy: string) {
  const rows = await supabaseRequest<BotSettings[]>("kr_bot_settings?id=eq.true", {
    method: "PATCH",
    headers: supabaseHeaders.represent,
    body: JSON.stringify({ ...values, updated_by: updatedBy, updated_at: new Date().toISOString() }),
  });
  return rows[0];
}

export function listConversations() {
  return supabaseRequest<Array<Record<string, unknown>>>("kr_conversations?select=id,telegram_chat_id,telegram_username,display_name,current_mode,relationship_state,updated_at&order=updated_at.desc&limit=100");
}

export function getConversationHistory(conversationId: string) {
  return supabaseRequest<Array<Record<string, unknown>>>(`kr_messages?conversation_id=eq.${conversationId}&select=id,direction,body,delivery_status,created_at,telegram_message_id&order=created_at.desc&limit=100`);
}

export function listMemories(conversationId?: string) {
  const filter = conversationId ? `conversation_id=eq.${conversationId}&` : "";
  return supabaseRequest<Array<Record<string, unknown>>>(`kr_memories?${filter}select=*&order=recorded_at.desc&limit=100`);
}

export function listOverrides() {
  return supabaseRequest<Array<Record<string, unknown>>>("kr_overrides?select=*&order=created_at.desc&limit=100");
}

export function createOverride(input: { scope: "GLOBAL" | "CONVERSATION"; conversationId?: string; instruction: string; createdBy: string; effectiveUntil?: string }) {
  return supabaseRequest<Array<Record<string, unknown>>>("kr_overrides", {
    method: "POST",
    headers: supabaseHeaders.represent,
    body: JSON.stringify({ scope: input.scope, conversation_id: input.scope === "CONVERSATION" ? input.conversationId : null, instruction: input.instruction, created_by: input.createdBy, effective_until: input.effectiveUntil ?? null }),
  });
}

export async function deactivateOverride(overrideId: string) {
  const rows = await supabaseRequest<Array<{ id: string }>>(`kr_overrides?id=eq.${overrideId}&is_active=eq.true`, {
    method: "PATCH",
    headers: supabaseHeaders.represent,
    body: JSON.stringify({ is_active: false }),
  });
  if (!rows[0]) throw new Error("This override is already inactive or unavailable.");
  return { success: true };
}

export function createMemory(input: Record<string, unknown>) {
  return supabaseRequest<Array<Record<string, unknown>>>("kr_memories", {
    method: "POST",
    headers: supabaseHeaders.represent,
    body: JSON.stringify(input),
  });
}
