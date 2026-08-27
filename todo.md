# Project TODO

- [x] Document the Kelvin Representative architecture, safety boundary, and operating assumptions.
- [x] Create Supabase tables and access policies for Telegram chats, messages, approval queue, memories, overrides, and webhook event records.
- [x] Add server-only configuration for Telegram bot token, webhook verification secret, Supabase URL, and Supabase service role key.
- [x] Implement Telegram update verification, idempotent inbound processing, and outbound message persistence.
- [x] Implement concise Kelvin-style draft generation with separate behavioral baseline, archive-derived context, and live verified state.
- [x] Implement high-risk and uncertainty classification that routes communications to an approval hold rather than auto-sending.
- [x] Implement structured five-layer memory with source, date, confidence, verification status, and explicit UNKNOWN state.
- [x] Add owner notification for every held approval item, including manual-review low-risk drafts.
- [x] Build the authenticated owner console with held-message review, draft edit/approve/reject actions, current overrides, conversation history, and webhook setup status.
- [x] Add server-side unit tests for webhook verification, risk holding, memory separation, and approval dispatch safeguards.
- [x] Validate the completed service locally and document the required production credential and Telegram setup steps.
- [x] Register and verify the Telegram webhook for https://kelvinbot-cxsk7qzu.manus.space/api/telegram/webhook.
