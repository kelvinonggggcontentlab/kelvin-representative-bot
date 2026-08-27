import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { validateMemoryTrustInvariant } from "./memoryPolicy";
import {
  approveOwnerReply,
  createOwnerMemory,
  createOwnerOverride,
  deactivateOwnerOverride,
  getOwnerApprovalEvents,
  getOwnerApprovalQueue,
  getOwnerConsoleStatus,
  getOwnerConversationHistory,
  listOwnerConversations,
  listOwnerMemories,
  listOwnerOverrides,
  registerOwnerWebhook,
  rejectOwnerReply,
  updateOwnerBotSettings,
} from "./ownerOperationsService";

const memorySchema = z.object({
  conversationId: z.string().uuid().optional(),
  memoryLayer: z.enum(["FACT", "RELATIONSHIP", "EPISODIC", "PREFERENCE", "STATE"]),
  subject: z.string().trim().min(1).max(160),
  statement: z.string().trim().min(1).max(4_000),
  structuredValue: z.record(z.string(), z.unknown()).default({}),
  sourceType: z.enum(["ARCHIVE", "LIVE_TELEGRAM", "OWNER_OVERRIDE", "SYSTEM"]),
  sourceReference: z.string().trim().max(500).optional(),
  observedAt: z.string().datetime().optional(),
  confidence: z.number().int().min(0).max(100),
  verificationStatus: z.enum(["OBSERVED", "INFERRED", "UNCERTAIN", "CONFLICT", "HISTORICAL", "CURRENT", "UNKNOWN"]),
  isLiveVerified: z.boolean().default(false),
}).superRefine((value, ctx) => {
  validateMemoryTrustInvariant(value).forEach(message => ctx.addIssue({ code: "custom", message }));
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  assistant: router({
    status: adminProcedure.query(() => getOwnerConsoleStatus()),
    approvals: adminProcedure.query(() => getOwnerApprovalQueue()),
    approvalEvents: adminProcedure.input(z.object({ approvalId: z.string().uuid() })).query(({ input }) => getOwnerApprovalEvents(input.approvalId)),
    conversations: adminProcedure.query(() => listOwnerConversations()),
    history: adminProcedure.input(z.object({ conversationId: z.string().uuid() })).query(({ input }) => getOwnerConversationHistory(input.conversationId)),
    memories: adminProcedure.input(z.object({ conversationId: z.string().uuid().optional() }).optional()).query(({ input }) => listOwnerMemories(input?.conversationId)),
    overrides: adminProcedure.query(() => listOwnerOverrides()),
    approve: adminProcedure.input(z.object({ approvalId: z.string().uuid(), editedText: z.string().trim().max(500).optional(), reviewerNote: z.string().trim().max(1_000).optional() })).mutation(({ input, ctx }) => approveOwnerReply({ ...input, reviewer: ctx.user.name || ctx.user.openId })),
    reject: adminProcedure.input(z.object({ approvalId: z.string().uuid(), reviewerNote: z.string().trim().max(1_000).optional() })).mutation(({ input, ctx }) => rejectOwnerReply({ ...input, reviewer: ctx.user.name || ctx.user.openId })),
    settings: adminProcedure.input(z.object({ autoSendLowRisk: z.boolean().optional(), botEnabled: z.boolean().optional() })).mutation(({ input, ctx }) => updateOwnerBotSettings({ auto_send_low_risk: input.autoSendLowRisk, bot_enabled: input.botEnabled }, ctx.user.name || ctx.user.openId)),
    setupWebhook: adminProcedure.input(z.object({ webhookUrl: z.string().url().refine(url => url.startsWith("https://"), "Webhook URL must use HTTPS.") })).mutation(({ input }) => registerOwnerWebhook(input.webhookUrl)),
    createOverride: adminProcedure.input(z.object({ scope: z.enum(["GLOBAL", "CONVERSATION"]), conversationId: z.string().uuid().optional(), instruction: z.string().trim().min(1).max(2_000), effectiveUntil: z.string().datetime().optional() }).refine(input => input.scope === "GLOBAL" || Boolean(input.conversationId), "A conversation override needs a conversation."))
      .mutation(({ input, ctx }) => createOwnerOverride({ ...input, createdBy: ctx.user.name || ctx.user.openId })),
    deactivateOverride: adminProcedure.input(z.object({ overrideId: z.string().uuid() })).mutation(({ input }) => deactivateOwnerOverride(input.overrideId)),
    createMemory: adminProcedure.input(memorySchema).mutation(({ input, ctx }) => createOwnerMemory({
      conversation_id: input.conversationId ?? null,
      memory_layer: input.memoryLayer,
      subject: input.subject,
      statement: input.statement,
      structured_value: input.structuredValue,
      source_type: input.sourceType,
      source_reference: input.sourceReference ?? null,
      observed_at: input.observedAt ?? null,
      confidence: input.confidence,
      verification_status: input.verificationStatus,
      is_live_verified: input.isLiveVerified,
      created_by: ctx.user.name || ctx.user.openId,
    })),
  }),
});

export type AppRouter = typeof appRouter;
