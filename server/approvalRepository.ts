import { ENV } from "./_core/env";
import type { ReplyDecision } from "./representative";
import { supabaseHeaders, supabaseRequest } from "./supabase";

export type ApprovalEventType = "CREATED" | "CLAIMED" | "APPROVED" | "REJECTED" | "SENT" | "SEND_FAILED" | "EXPIRED";
export type ApprovalRecord = { id: string; conversation_id: string; inbound_message_id: string; draft_text: string; status: string };
export type ApprovalQueueRow = ApprovalRecord & { risk_level: string; risk_categories: string[]; hold_reason: string; created_at: string; expires_at: string | null };
export type ClaimedApproval = ApprovalRecord & { edited_text?: string | null; reviewer_note?: string | null };

export function appendApprovalEvent(input: { approvalId: string; eventType: ApprovalEventType; actorType: "SYSTEM" | "OWNER"; actorId?: string; correlationId?: string; detail?: Record<string, unknown> }) {
  return supabaseRequest("kr_approval_events", { method: "POST", body: JSON.stringify({ approval_item_id: input.approvalId, event_type: input.eventType, actor_type: input.actorType, actor_id: input.actorId ?? null, correlation_id: input.correlationId ?? null, detail: input.detail ?? {} }) });
}

export async function createApprovalItem(input: { conversationId: string; inboundMessageId: string; decision: ReplyDecision; holdReason?: string; correlationId?: string }) {
  const expiresAt = new Date(Date.now() + ENV.approvalExpiryHours * 60 * 60 * 1_000).toISOString();
  const rows = await supabaseRequest<ApprovalRecord[]>("kr_approval_items", { method: "POST", headers: supabaseHeaders.represent, body: JSON.stringify({ conversation_id: input.conversationId, inbound_message_id: input.inboundMessageId, risk_level: input.decision.riskLevel, risk_categories: input.decision.riskCategories, hold_reason: input.holdReason ?? input.decision.holdReason, draft_text: input.decision.draftText, expires_at: expiresAt }) });
  if (!rows[0]) throw new Error("Approval item creation did not return a row.");
  await appendApprovalEvent({ approvalId: rows[0].id, eventType: "CREATED", actorType: "SYSTEM", correlationId: input.correlationId, detail: { riskLevel: input.decision.riskLevel, categories: input.decision.riskCategories, expiresAt } });
  return rows[0];
}

export async function expirePendingApprovals() {
  const now = new Date().toISOString();
  const rows = await supabaseRequest<Array<{ id: string }>>(`kr_approval_items?status=eq.PENDING&expires_at=lt.${encodeURIComponent(now)}`, { method: "PATCH", headers: supabaseHeaders.represent, body: JSON.stringify({ status: "EXPIRED", finalized_at: now, updated_at: now }) });
  await Promise.all(rows.map(row => appendApprovalEvent({ approvalId: row.id, eventType: "EXPIRED", actorType: "SYSTEM", detail: { reason: "approval_expired" } })));
}

export function listPendingOrFailedApprovals() { return supabaseRequest<ApprovalQueueRow[]>("kr_approval_items?status=in.(PENDING,SEND_FAILED)&order=created_at.desc&limit=50"); }
export function listApprovalEvents(approvalId: string) { return supabaseRequest<Array<Record<string, unknown>>>(`kr_approval_events?approval_item_id=eq.${approvalId}&select=event_type,actor_type,actor_id,detail,created_at&order=created_at.asc&limit=50`); }

type ApprovalClaimUpdate = (approvalId: string, values: Record<string, unknown>, now: string) => Promise<ClaimedApproval[]>;

export async function claimApprovalForSend(input: { approvalId: string; reviewer: string; editedText?: string; reviewerNote?: string }, claim: ApprovalClaimUpdate = async (approvalId, values, now) => {
  return supabaseRequest<ClaimedApproval[]>(`kr_approval_items?id=eq.${approvalId}&status=in.(PENDING,SEND_FAILED)&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(now)})`, { method: "PATCH", headers: supabaseHeaders.represent, body: JSON.stringify(values) });
}): Promise<ClaimedApproval | null> {
  const now = new Date().toISOString();
  const rows = await claim(input.approvalId, { status: "SENDING", edited_text: input.editedText?.trim() || null, reviewer_note: input.reviewerNote?.trim() || null, reviewed_by: input.reviewer, reviewed_at: now, claimed_at: now, updated_at: now }, now);
  return rows[0] ?? null;
}
