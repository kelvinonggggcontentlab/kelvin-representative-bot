function parseCommaSeparatedIds(value: string | undefined) {
  return (value ?? "").split(",").map(item => item.trim()).filter(item => /^-?\d+$/.test(item));
}

function parseFlag(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  telegramOwnerChatId: process.env.TELEGRAM_OWNER_CHAT_ID ?? "",
  allowedTelegramChatIds: parseCommaSeparatedIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  telegramWebhookPath: "/api/telegram/webhook",
  externalRequestTimeoutMs: Number.parseInt(process.env.EXTERNAL_REQUEST_TIMEOUT_MS ?? "10000", 10),
  approvalExpiryHours: Number.parseInt(process.env.APPROVAL_EXPIRY_HOURS ?? "72", 10),
  featureFlags: {
    autoReplyEnabled: parseFlag(process.env.FEATURE_AUTO_REPLY_ENABLED, true),
    archiveReferenceEnabled: parseFlag(process.env.FEATURE_ARCHIVE_REFERENCE_ENABLED, false),
  },
};

export function getConfigurationStatus() {
  return {
    telegram: Boolean(ENV.telegramBotToken),
    webhookSecret: /^[A-Za-z0-9_-]{1,256}$/.test(ENV.telegramWebhookSecret),
    supabase: Boolean(ENV.supabaseUrl && ENV.supabaseServiceRoleKey),
    ownerNotification: Boolean(ENV.telegramOwnerChatId),
    externalTimeoutValid: Number.isFinite(ENV.externalRequestTimeoutMs) && ENV.externalRequestTimeoutMs >= 1_000 && ENV.externalRequestTimeoutMs <= 30_000,
  };
}
