import { invokeLLM } from "./_core/llm";
import { supabaseRequest } from "./supabase";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
export type ConversationMode = "CASUAL" | "PLAYFUL" | "CARING" | "SERIOUS" | "CONFLICT" | "OPERATIONAL" | "HIGH_RISK";

type MemoryRecord = {
  memory_layer: string;
  subject: string;
  statement: string;
  source_type: "ARCHIVE" | "LIVE_TELEGRAM" | "OWNER_OVERRIDE" | "SYSTEM";
  verification_status: string;
  is_live_verified: boolean;
  observed_at: string | null;
};

type OverrideRecord = {
  conversation_id: string | null;
  scope: "GLOBAL" | "CONVERSATION";
  instruction: string;
  effective_until: string | null;
};

export type ReplyDecision = {
  draftText: string;
  mode: ConversationMode;
  riskLevel: RiskLevel;
  riskCategories: string[];
  requiresApproval: boolean;
  holdReason: string;
};

const highRiskRules = [
  { category: "LEGAL", terms: ["lawyer", "lawsuit", "court", "legal", "liable", "liability", "settlement", "saman", "律师", "法庭", "法律", "赔偿"] },
  { category: "FINANCIAL", terms: ["transfer", "bank in", "pay you", "refund", "loan", "debt", "investment", "wallet", "duit", "钱", "借钱", "还钱", "转账", "投资"] },
  { category: "SECURITY_ACCESS", terms: ["password", "otp", "code", "access", "login", "key", "security", "account", "密码", "验证码", "权限", "账号"] },
  { category: "MEDICAL", terms: ["diagnosis", "medicine", "medication", "doctor said", "medical", "hospital", "药", "医生", "诊断", "医院"] },
  { category: "CONFIDENTIAL", terms: ["secret", "confidential", "private", "leak", "don't tell", "confidential", "机密", "秘密", "不要告诉"] },
  { category: "RELATIONSHIP_COMMITMENT", terms: ["break up", "separate", "marry", "relationship", "reconcile", "move in", "分手", "结婚", "复合", "关系"] },
  { category: "AUTHORIZATION", terms: ["approve", "authorize", "permission", "terminate", "ban", "revoke", "批准", "授权", "开除", "封锁"] },
];

const uncertainTerms = ["where are you", "when are you coming", "are you free", "can you promise", "you said", "what do you feel", "你在哪里", "你几点来", "你有空吗", "你答应", "你怎么想"];

const approvalIntentRules = [
  { category: "ENQUIRY", terms: ["?", "？", "how much", "price", "quotation", "quote", "can you", "could you", "may i", "boleh", "berapa", "多少钱", "可以吗", "请问", "什么", "怎么", "几时", "哪里"] },
  { category: "TASK_REQUEST", terms: ["please send", "please arrange", "please book", "please help", "can you send", "can you arrange", "can you book", "帮我", "安排", "处理", "发给我", "订"] },
  { category: "APPROVAL_OR_DECISION", terms: ["approve", "approval", "decide", "decision", "confirm", "confirming", "agree", "accept", "批准", "决定", "确认", "同意"] },
];

export function findDeterministicRiskSignals(message: string) {
  const normalized = message.toLowerCase();
  const highRiskCategories = highRiskRules
    .filter(rule => rule.terms.some(term => normalized.includes(term.toLowerCase())))
    .map(rule => rule.category);
  const approvalIntentCategories = approvalIntentRules
    .filter(rule => rule.terms.some(term => normalized.includes(term.toLowerCase())))
    .map(rule => rule.category);
  const uncertainty = uncertainTerms.some(term => normalized.includes(term.toLowerCase()));

  return {
    categories: [...highRiskCategories, ...approvalIntentCategories],
    highRiskCategories,
    approvalIntentCategories,
    uncertainty,
    requiresApproval: highRiskCategories.length > 0 || approvalIntentCategories.length > 0 || uncertainty,
  };
}

function cleanText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 500) : fallback;
}

function validRisk(value: unknown): RiskLevel {
  return ["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"].includes(String(value))
    ? (value as RiskLevel)
    : "UNKNOWN";
}

function validMode(value: unknown): ConversationMode {
  return ["CASUAL", "PLAYFUL", "CARING", "SERIOUS", "CONFLICT", "OPERATIONAL", "HIGH_RISK"].includes(String(value))
    ? (value as ConversationMode)
    : "HIGH_RISK";
}

export function partitionMemories(memories: MemoryRecord[]) {
  return {
    archive: memories.filter(memory => memory.source_type === "ARCHIVE"),
    live: memories.filter(memory => memory.is_live_verified && memory.source_type !== "ARCHIVE"),
    unverified: memories.filter(memory => !memory.is_live_verified && memory.source_type !== "ARCHIVE"),
  };
}

async function loadContext(conversationId: string) {
  const [memories, overrides] = await Promise.all([
    supabaseRequest<MemoryRecord[]>(`kr_memories?conversation_id=eq.${conversationId}&is_active=eq.true&order=recorded_at.desc&limit=30`),
    supabaseRequest<OverrideRecord[]>("kr_overrides?is_active=eq.true&order=created_at.desc&limit=30"),
  ]);

  const now = Date.now();
  const activeOverrides = overrides.filter(override =>
    (override.scope === "GLOBAL" || override.conversation_id === conversationId)
    && (!override.effective_until || new Date(override.effective_until).getTime() > now)
  );

  return { ...partitionMemories(memories), overrides: activeOverrides };
}

function memoryLines(memories: MemoryRecord[]) {
  return memories.length
    ? memories.map(memory => `- [${memory.memory_layer}/${memory.verification_status}] ${memory.subject}: ${memory.statement}`).join("\n")
    : "- None recorded.";
}

export async function generateReplyDecision(input: {
  conversationId: string;
  incomingText: string;
  recentMessages: Array<{ direction: string; body: string | null }>;
}) : Promise<ReplyDecision> {
  const deterministic = findDeterministicRiskSignals(input.incomingText);
  const context = await loadContext(input.conversationId);

  const systemPrompt = `You draft concise Telegram replies in Kelvin's communication baseline. Use concise Malaysian-Chinese / English-mixed wording when natural; do not force slang or intimacy. Kelvin is direct, practical, concise, and context-sensitive. Stabilize ordinary distress first, then make the immediate next step clear. Use a formal, procedural tone only for verified operational matters.

Critical fidelity policy: behavioural style is not current knowledge or authority. Archive-derived context is historical and must never be written as current fact. Only LIVE VERIFIED STATE may support a current claim. When live state is absent, return UNKNOWN and ask the smallest useful clarification. Never invent Kelvin's feelings, whereabouts, plans, relationship status, BlackTower status, commitments, promises, or authorization.

For legal, financial, medical, security/access, confidential, disciplinary, relationship commitment, or other irreversible matters, write only a neutral acknowledgement or factual clarification that does not make a decision. Those must require approval. Do not use 'As an AI' or corporate customer-service language.

Return only the requested JSON object.`;

  const userPrompt = `INCOMING MESSAGE:
${input.incomingText}

RECENT LIVE CONVERSATION:
${input.recentMessages.map(message => `- ${message.direction}: ${message.body ?? "[non-text]"}`).join("\n") || "- No recent messages."}

ARCHIVE-DERIVED CONTEXT (historical, NOT current):
${memoryLines(context.archive)}

LIVE VERIFIED STATE (safe to treat as current):
${memoryLines(context.live)}

UNVERIFIED LIVE NOTES (do NOT turn into current fact):
${memoryLines(context.unverified)}

KELVIN'S CURRENT OVERRIDES:
${context.overrides.length ? context.overrides.map(override => `- ${override.instruction}`).join("\n") : "- None."}`;

  try {
    const completion = await invokeLLM({
      model: "gpt-5-mini",
      max_tokens: 450,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "kelvin_reply_decision",
          strict: true,
          schema: {
            type: "object",
            properties: {
              draftText: { type: "string" },
              mode: { type: "string", enum: ["CASUAL", "PLAYFUL", "CARING", "SERIOUS", "CONFLICT", "OPERATIONAL", "HIGH_RISK"] },
              riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"] },
              riskCategories: { type: "array", items: { type: "string" } },
              requiresApproval: { type: "boolean" },
              holdReason: { type: "string" },
            },
            required: ["draftText", "mode", "riskLevel", "riskCategories", "requiresApproval", "holdReason"],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = completion.choices[0]?.message.content;
    const content = typeof raw === "string" ? raw : raw?.filter(part => part.type === "text").map(part => part.text).join("") ?? "";
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const modelRisk = validRisk(parsed.riskLevel);
    const modelCategories = Array.isArray(parsed.riskCategories)
      ? parsed.riskCategories.filter((item): item is string => typeof item === "string").slice(0, 6)
      : [];
    const forceHold = deterministic.requiresApproval || parsed.requiresApproval === true || modelRisk !== "LOW";
    const categories = Array.from(new Set([...deterministic.categories, ...modelCategories, ...(deterministic.uncertainty ? ["UNKNOWN_CURRENT_STATE"] : [])]));

    return {
      draftText: cleanText(parsed.draftText, "Noted. I need to check the actual situation first."),
      mode: forceHold ? "HIGH_RISK" : validMode(parsed.mode),
      riskLevel: deterministic.highRiskCategories.length > 0 ? "HIGH" : (deterministic.uncertainty ? "UNKNOWN" : (deterministic.approvalIntentCategories.length > 0 ? "MEDIUM" : modelRisk)),
      riskCategories: categories,
      requiresApproval: forceHold,
      holdReason: deterministic.highRiskCategories.length > 0
        ? `Automatic hold: ${deterministic.highRiskCategories.join(", ")}.`
        : deterministic.approvalIntentCategories.length > 0
          ? `Approval required: ${deterministic.approvalIntentCategories.join(", ")}.`
        : deterministic.uncertainty
          ? "Automatic hold: current Kelvin state or intent is unknown."
          : cleanText(parsed.holdReason, forceHold ? "Draft requires Kelvin confirmation." : "Low-risk context-aware draft."),
    };
  } catch (error) {
    return {
      draftText: "Noted. I need to check the actual situation first.",
      mode: "HIGH_RISK",
      riskLevel: "UNKNOWN",
      riskCategories: ["DRAFT_GENERATION_FALLBACK"],
      requiresApproval: true,
      holdReason: `Automatic hold: draft generation could not be verified (${error instanceof Error ? error.message.slice(0, 120) : "unknown error"}).`,
    };
  }
}
