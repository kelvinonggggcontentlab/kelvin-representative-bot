import { SupabaseServiceError, supabaseHeaders, supabaseRequest } from "./supabase";

export type WebhookClaim = "CLAIMED" | "DUPLICATE";

export function isDuplicateWebhookClaim(error: unknown) {
  return error instanceof SupabaseServiceError && error.status === 409;
}

type WebhookEventInsert = (input: { updateId: number; payload: unknown; correlationId?: string }) => Promise<void>;

export async function claimWebhookEventWith(input: { updateId: number; payload: unknown; correlationId?: string }, insert: WebhookEventInsert): Promise<WebhookClaim> {
  try {
    await insert(input);
    return "CLAIMED";
  } catch (error) {
    if (isDuplicateWebhookClaim(error)) return "DUPLICATE";
    throw error;
  }
}

export function claimWebhookEvent(input: { updateId: number; payload: unknown; correlationId?: string }) {
  return claimWebhookEventWith(input, async event => {
    await supabaseRequest("kr_webhook_events", { method: "POST", headers: supabaseHeaders.represent, body: JSON.stringify({ telegram_update_id: event.updateId, verified: true, payload: event.payload, processing_status: "PROCESSING", correlation_id: event.correlationId ?? null, attempt_count: 1 }) });
  });
}

export function markWebhookEvent(updateId: number, values: Record<string, unknown>) {
  return supabaseRequest(`kr_webhook_events?telegram_update_id=eq.${updateId}`, { method: "PATCH", headers: supabaseHeaders.represent, body: JSON.stringify(values) });
}
