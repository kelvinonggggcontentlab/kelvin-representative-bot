import { randomUUID } from "crypto";

export type CorrelationContext = {
  correlationId: string;
  updateId?: number;
  conversationId?: string;
  approvalId?: string;
};

type LogLevel = "debug" | "info" | "warn" | "error";

const sensitiveKeyPattern = /authorization|cookie|token|secret|password|api.?key|body|payload|message|content/i;

function redact(value: unknown, key?: string): unknown {
  if (key && sensitiveKeyPattern.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value.length > 180 ? `${value.slice(0, 180)}…[TRUNCATED]` : value;
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return `[${value.length} item(s)]`;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]));
}

export function createCorrelationId() {
  return randomUUID();
}

export function logEvent(level: LogLevel, event: string, context: Partial<CorrelationContext> & Record<string, unknown> = {}) {
  const sanitizedContext = redact(context) as Record<string, unknown>;
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    event,
    ...sanitizedContext,
  });
  console[level](entry);
}

export function safeErrorSummary(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message.slice(0, 240) };
  return { name: "UnknownError", message: "An unknown error occurred." };
}
