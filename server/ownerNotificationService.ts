import { ENV } from "./_core/env";
import { notifyOwner } from "./_core/notification";
import type { ReplyDecision } from "./representative";
import { supabaseHeaders, supabaseRequest } from "./supabase";
import { sendTelegramMessage } from "./telegram";

type ApprovalReference = { id: string };

export async function notifyOwnerOfApproval(approval: ApprovalReference, decision: ReplyDecision, incomingText: string) {
  const summary = `Risk: ${decision.riskLevel}. ${decision.holdReason}\n\nIncoming: ${incomingText.slice(0, 400)}\n\nDraft: ${decision.draftText}`;
  await notifyOwner({ title: "Kelvin Representative: approval required", content: summary }).catch(() => false);
  const notifications = await supabaseRequest<Array<{ id: string }>>("kr_owner_notifications", { method: "POST", headers: supabaseHeaders.represent, body: JSON.stringify({ approval_item_id: approval.id, channel: "TELEGRAM_OWNER", status: ENV.telegramOwnerChatId ? "PENDING" : "SKIPPED" }) });
  if (!ENV.telegramOwnerChatId || !notifications[0]) return;
  try {
    const sent = await sendTelegramMessage(ENV.telegramOwnerChatId, `REVIEW REQUIRED\n\n${summary}`);
    await supabaseRequest(`kr_owner_notifications?id=eq.${notifications[0].id}`, { method: "PATCH", headers: supabaseHeaders.represent, body: JSON.stringify({ status: "SENT", external_message_id: sent.message_id, sent_at: new Date().toISOString() }) });
  } catch (error) {
    await supabaseRequest(`kr_owner_notifications?id=eq.${notifications[0].id}`, { method: "PATCH", headers: supabaseHeaders.represent, body: JSON.stringify({ status: "FAILED", error_message: error instanceof Error ? error.message.slice(0, 500) : "Unknown notification error" }) });
  }
}
