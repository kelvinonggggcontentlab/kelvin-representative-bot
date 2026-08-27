import { supabaseHeaders, supabaseRequest } from "./supabase";

export function listMemoriesByConversation(conversationId?: string) {
  return supabaseRequest<Array<Record<string, unknown>>>(`kr_memories?${conversationId ? `conversation_id=eq.${conversationId}&` : ""}select=*&order=recorded_at.desc&limit=100`);
}

export function insertMemory(memory: Record<string, unknown>) {
  return supabaseRequest<Array<Record<string, unknown>>>("kr_memories", { method: "POST", headers: supabaseHeaders.represent, body: JSON.stringify(memory) });
}
