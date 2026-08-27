import { ENV } from "./_core/env";
import { logEvent } from "./observability";

type SupabaseInit = RequestInit & { headers?: Record<string, string> };

export class SupabaseServiceError extends Error {
  constructor(public readonly status: number, public readonly retryable: boolean, public readonly operation: string) {
    super(`Supabase ${operation} failed with status ${status}.`);
    this.name = "SupabaseServiceError";
  }
}

function getRestBaseUrl() {
  if (!ENV.supabaseUrl || !ENV.supabaseServiceRoleKey) {
    throw new Error("Supabase server credentials are not configured.");
  }

  return `${new URL(ENV.supabaseUrl).origin}/rest/v1`;
}

function operationName(path: string) {
  return path.replace(/^\//, "").split("?")[0]?.slice(0, 80) || "unknown";
}

function shouldRetry(method: string, status?: number) {
  return ["GET", "HEAD"].includes(method) && (status === undefined || status === 408 || status === 429 || status >= 500);
}

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function supabaseRequest<T>(path: string, init: SupabaseInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const operation = operationName(path);
  const attempts = shouldRetry(method) ? 2 : 1;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(`${getRestBaseUrl()}/${path.replace(/^\//, "")}`, {
        ...init,
        headers: {
          apikey: ENV.supabaseServiceRoleKey,
          Authorization: `Bearer ${ENV.supabaseServiceRoleKey}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
        signal: AbortSignal.timeout(ENV.externalRequestTimeoutMs),
      });

      if (response.status === 204) return undefined as T;
      const contentType = response.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json") ? await response.json() : await response.text();
      if (response.ok) return body as T;

      const retryable = shouldRetry(method, response.status);
      if (retryable && attempt < attempts) {
        logEvent("warn", "supabase_retry", { operation, status: response.status, attempt });
        await delay(150 * attempt);
        continue;
      }
      throw new SupabaseServiceError(response.status, retryable, operation);
    } catch (error) {
      if (error instanceof SupabaseServiceError) throw error;
      if (shouldRetry(method) && attempt < attempts) {
        logEvent("warn", "supabase_retry", { operation, attempt, failure: error instanceof Error ? error.name : "UnknownError" });
        await delay(150 * attempt);
        continue;
      }
      throw new SupabaseServiceError(0, shouldRetry(method), operation);
    }
  }

  throw new SupabaseServiceError(0, false, operation);
}

export const supabaseHeaders = {
  represent: { Prefer: "return=representation" },
  upsert: { Prefer: "resolution=merge-duplicates,return=representation" },
};

export async function checkSupabaseReadiness() {
  if (!ENV.supabaseUrl || !ENV.supabaseServiceRoleKey) return false;
  try {
    await supabaseRequest<unknown[]>("kr_bot_settings?select=id&limit=1");
    return true;
  } catch {
    return false;
  }
}
