# Kelvin Representative Telegram Assistant

## Operating Purpose

The service drafts concise, context-aware Telegram responses in Kelvin’s established communication style. It is **not** an autonomous proxy for Kelvin’s current intent, authority, legal position, financial commitments, medical judgement, security access, or confidential disclosures. The system is designed to preserve speed on ordinary messages while keeping Kelvin in command whenever a response could create risk or irreversible consequence.

## Request Flow

| Stage | Behaviour | Control |
| --- | --- | --- |
| **1. Verified intake** | Telegram sends an HTTPS update to `POST /api/telegram/webhook`. The backend checks `X-Telegram-Bot-Api-Secret-Token` before accepting it. | Requests without a matching secret are rejected with `401`. |
| **2. Idempotent persistence** | The `update_id` is stored in `kr_webhook_events` before processing. Duplicate deliveries are acknowledged without repeating a reply. Inbound and outbound messages are separately persisted in `kr_messages`. | Prevents Telegram retries from producing duplicate messages. |
| **3. Context assembly** | The draft engine receives recent live messages, archive-derived memory, live verified memory, unverified notes, and active owner overrides. | Archive-derived context and live verified state are separate fields and prompt sections. |
| **4. Safety gate** | Deterministic category checks run before delivery. The model returns a structured decision with draft, mode, risk level, risk categories, and approval requirement. | Programmatic risk signals override model confidence. Unknown current intent or state is held. |
| **5. Approval or send** | High-risk, uncertain, and all drafts in manual-review mode become `kr_approval_items`. Only an authenticated owner’s approve action can send an item in the queue. | Auto-send is disabled by default. Enabling low-risk auto-send cannot bypass a hold. |
| **6. Notification and traceability** | Each held item triggers a platform owner notification and, if configured, a Telegram owner alert. The result is tracked in `kr_owner_notifications`. | Kelvin is alerted without exposing credentials or bypassing review. |

## Memory Contract

The memory system uses five layers: **FACT**, **RELATIONSHIP**, **EPISODIC**, **PREFERENCE**, and mutable **STATE**. Each row stores the statement, source type, source reference, observation date, recording date, confidence, verification status, current-live verification flag, and active/expiry state.

| Context class | Permitted use in a reply | Example status |
| --- | --- | --- |
| **Archive-derived context** | Communication rhythm and historical context only. It must not be represented as Kelvin’s current position. | `ARCHIVE` + `HISTORICAL` |
| **Live verified state** | May support a current factual statement only when explicitly marked live verified. | `LIVE_TELEGRAM` or `OWNER_OVERRIDE` + `CURRENT` |
| **Unverified note** | May guide a clarification request, but not a factual assertion or commitment. | `UNCERTAIN`, `CONFLICT`, or `UNKNOWN` |
| **Explicit UNKNOWN** | A valid, intentional state when present data does not establish Kelvin’s current position. | `UNKNOWN` |

## Automatic Hold Rules

The backend automatically holds messages involving legal statements, financial promises or transfers, medical claims, security or access authorization, confidential information, relationship commitments, disciplinary decisions, or other authorization. It also holds messages asking about Kelvin’s current whereabouts, availability, plans, feelings, or promises when the live verified state does not answer them.

> **Fail closed:** if the structured draft step fails, the system creates a neutral holding draft and sends nothing automatically.

## Authentication and Secrets

The owner console is protected by the project’s authenticated admin procedure. Telegram and Supabase credentials are accessed only through server-side environment variables. Supabase access uses the service role inside the backend; the browser never receives its key. The `kr_*` tables retain row-level security with explicit `service_role` policies, so untrusted public clients cannot access message, memory, or approval data.

## Operating Assumptions

The bot processes text messages and business text messages in this version. Non-text updates are recorded as ignored rather than being transformed into an unsafe guess. Manual review is the default. Kelvin may enable low-risk auto-send after observing draft quality, but the deterministic safety gate always remains active. The webhook should only be registered after a published production URL is available, not against a temporary preview URL.
