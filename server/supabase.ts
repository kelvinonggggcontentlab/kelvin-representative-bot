import { ENV } from "./_core/env";

type SupabaseInit = RequestInit & { headers?: Record<string, string> };

function getRestBaseUrl() {
  if (!ENV.supabaseUrl || !ENV.supabaseServiceRoleKey) {
    throw new Error("Supabase server credentials are not configured.");
  }

  return `${new URL(ENV.supabaseUrl).origin}/rest/v1`;
}

export async function supabaseRequest<T>(path: string, init: SupabaseInit = {}): Promise<T> {
  const response = await fetch(`${getRestBaseUrl()}/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      apikey: ENV.supabaseServiceRoleKey,
      Authorization: `Bearer ${ENV.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }

  return body as T;
}

export const supabaseHeaders = {
  represent: { Prefer: "return=representation" },
  upsert: { Prefer: "resolution=merge-duplicates,return=representation" },
};
