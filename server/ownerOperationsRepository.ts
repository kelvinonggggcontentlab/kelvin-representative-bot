import { supabaseHeaders, supabaseRequest } from "./supabase";

export type BotSettings = { auto_send_low_risk: boolean; bot_enabled: boolean };

export async function getBotSettingsRecord() {
  const rows = await supabaseRequest<BotSettings[]>("kr_bot_settings?id=eq.true&select=auto_send_low_risk,bot_enabled&limit=1");
  return rows[0] ?? { auto_send_low_risk: false, bot_enabled: true };
}

export async function updateBotSettingsRecord(values: Partial<BotSettings>, updatedBy: string) {
  const rows = await supabaseRequest<BotSettings[]>("kr_bot_settings?id=eq.true", { method: "PATCH", headers: supabaseHeaders.represent, body: JSON.stringify({ ...values, updated_by: updatedBy, updated_at: new Date().toISOString() }) });
  return rows[0];
}

export function listConversationRecords() { return supabaseRequest<Array<Record<string, unknown>>>("kr_conversations?select=id,telegram_chat_id,telegram_username,display_name,current_mode,relationship_state,updated_at&order=updated_at.desc&limit=100"); }
export function getConversationMessageHistory(conversationId: string) { return supabaseRequest<Array<Record<string, unknown>>>(`kr_messages?conversation_id=eq.${conversationId}&select=id,direction,body,delivery_status,created_at,telegram_message_id&order=created_at.desc&limit=100`); }
export function listOverrideRecords() { return supabaseRequest<Array<Record<string, unknown>>>("kr_overrides?select=*&order=created_at.desc&limit=100"); }
export function insertOverrideRecord(input: { scope: "GLOBAL" | "CONVERSATION"; conversationId?: string; instruction: string; createdBy: string; effectiveUntil?: string }) { return supabaseRequest<Array<Record<string, unknown>>>("kr_overrides", { method: "POST", headers: supabaseHeaders.represent, body: JSON.stringify({ scope: input.scope, conversation_id: input.scope === "CONVERSATION" ? input.conversationId : null, instruction: input.instruction, created_by: input.createdBy, effective_until: input.effectiveUntil ?? null }) }); }
export async function deactivateOverrideRecord(overrideId: string) { const rows = await supabaseRequest<Array<{ id: string }>>(`kr_overrides?id=eq.${overrideId}&is_active=eq.true`, { method: "PATCH", headers: supabaseHeaders.represent, body: JSON.stringify({ is_active: false }) }); if (!rows[0]) throw new Error("This override is already inactive or unavailable."); return { success: true }; }
