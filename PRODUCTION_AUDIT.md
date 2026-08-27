# KELVIN REPRESENTATIVE™ Production Audit

**Status:** Gap-closure implementation complete. This document records the pre-refactor baseline, the implemented controls, and remaining shared-platform risks.

## Governing Acceptance Standard

The system must reliably represent Kelvin’s communication and decision style without treating language imitation as authority. It must separate trusted representative configuration, live verified state, archived material, untrusted Telegram input, risk policy, approval action, and infrastructure secrets. It must be secure under webhook retries, malformed input, unauthorized access, provider failures, and model-output failure.

## Current Architecture Map

| Layer | Current implementation | Evidence |
| --- | --- | --- |
| HTTP ingress | Express server with a Telegram webhook and tRPC router. | `server/_core/index.ts` |
| Telegram | Thin Bot API adapter with send, webhook registration, webhook status, 15-second request timeout, and shared-secret comparison. | `server/telegram.ts` |
| Application flow | `processTelegramUpdate` creates conversations and records, generates a decision, routes to approval or sends a reply. Owner-console actions are isolated from this webhook flow. | `server/botService.ts`; `server/ownerOperationsService.ts` |
| AI | Structured JSON-schema response through server-only `invokeLLM`, with deterministic risk signals as a backstop. | `server/representative.ts` |
| Memory | Supabase `kr_memories` with five layers, confidence, provenance, validity state, and archive/live separation. | `supabase/migrations/202608270001_kelvin_representative.sql` |
| Approval | Supabase approval row plus owner notification and a dedicated owner-operations service for queue, lifecycle, diagnostics, and setup actions. | `kr_approval_items`; `server/ownerOperationsService.ts`; `server/routers.ts` |
| Owner console | Manus-authenticated dashboard with review, history, memory, overrides, and setup routes. | `client/src/pages/Home.tsx`; `server/routers.ts` |
| Authentication | Manus OAuth session with server-side `adminProcedure` for console actions. | `server/_core/sdk.ts`; `server/_core/trpc.ts` |

## What Already Works

Telegram’s production HTTPS webhook is registered and its shared-secret header is checked. Update IDs are unique in `kr_webhook_events`, giving a base idempotency mechanism. Server-side Telegram and Supabase secrets are not sent to the browser. The existing database has foreign keys, timestamps, status columns, and row-level security with explicit service-role policies on the `kr_*` tables. The model decision uses a strict JSON schema, and the existing prompt separates archived history from live verified state. High-impact content is held for owner approval, and approved replies are recorded.

## Critical Gaps and Risks

| Priority | Finding | Production risk | Planned direction |
| --- | --- | --- | --- |
| **P0** | The webhook receives arbitrary `req.body` without a normalized runtime schema. | Malformed or adversarial updates can enter the orchestration path. | Add Zod-based update normalization and reject or safely ignore unsupported payloads. |
| **P0** | No stable Telegram allowlist or account policy is enforced. Usernames and display names are stored but are not suitable identity controls. | Unauthorized chats can initiate representative workflows. | Add stable Telegram user/chat policy controls and owner-managed access states. |
| **P0** | Browser/network diagnostic logs retain request authorization metadata and message payloads. | Session credentials and sensitive Telegram content may be retained in operational logs. | Redact headers and bodies at the application logging boundary; avoid writing sensitive request data to custom logs. |
| **P0** | Approval follow-up replies are tied to the original Telegram reply target and live logs show `message to be replied not found` failures. | A valid Kelvin approval can fail to reach the user and leave a misleading approval state. | Treat reply threading as best-effort, retry safely without a reply target, and retain a clear `SEND_FAILED`/sent audit event. |
| **P0** | The application, risk, approval, and persistence responsibilities are concentrated in `botService.ts`. | Harder to test, reason about, and safely modify. | Split into Telegram adapter, orchestrator, risk policy, approval service, memory repository, and audit logger. |
| **P1** | Supabase requests have no timeout, typed service errors, retry policy, or redaction-aware instrumentation. | A failed dependency can hang processing or leave poor forensic evidence. | Add bounded request timeout, safe retry classification, error taxonomy, and correlation-aware logging. |
| **P1** | Owner approval uses a basic pending-status claim but lacks expiry, explicit final-action state, and durable event trail. | Stale items and operational ambiguity increase over time. | Add approval expiry, immutable approval events, and single-send lifecycle guards. |
| **P1** | The representative profile remains embedded mainly in source prompt text. | Voice and policy updates require code deployment; profile drift is likely. | Create a separate versioned representative-profile configuration with policy-owned constants. |
| **P1** | No lightweight unauthenticated health endpoint distinguishes app, database, and Telegram readiness. | Operators cannot quickly isolate a live incident. | Add a redacted health/readiness endpoint and console diagnostics. |
| **P2** | Memory retrieval returns the most recent 30 records without relevance ranking, lifecycle expiry processing, or document-reference integration. | Prompt pollution and context leakage become more likely as history grows. | Add scoped relevance filters, record access metadata, and optional Google Drive reference integration. |
| **P2** | The owner console and router are monolithic and use weak dynamic typing. | Maintainability and UI safety degrade as features grow. | Split domain routers and typed console components. |
| **P2** | Production dependency audit reported 1 critical, 21 high, 49 moderate, and 10 low advisories among 598 runtime dependencies. | Transitive dependency exposure and deployment noise. | Reduce unused surface area and upgrade or override affected packages after compatibility testing. |

## Integration Findings

The current session has a connected Google Workspace account, while the web application does not yet have a server-side Google Drive credential or document sync mechanism. The production upgrade will therefore add a controlled knowledge-reference boundary and document that real Drive sync remains disabled until a server-side integration is explicitly configured. Existing Drive-related Supabase tables were observed but are not treated as current or trusted bot context until their access policy, provenance, and retrieval path are verified.

## Validation and Live Database Evidence

The pre-refactor test baseline passed with **5 test files and 18 assertions**, and TypeScript completed without errors. The dependency audit reported **1 critical, 21 high, 49 moderate, and 10 low** runtime advisories across 598 packages; this is largely template/transitive surface and will be reduced or pinned where a safe compatibility path exists.

The Supabase security advisor reported no missing-policy finding for the `kr_*` Telegram-assistant tables. It did report RLS-without-policy findings on unrelated legacy tables in the shared Supabase project. Those tables are not touched by this bot and will not be changed automatically because their intended access model is unknown. The advisor also flagged missing foreign-key indexes on `kr_approval_items.conversation_id`, `kr_approval_items.outbound_message_id`, `kr_overrides.conversation_id`, and `kr_owner_notifications.approval_item_id`; the assistant migration will add those scoped indexes.

## Audit Decision

The production upgrade will preserve the existing provider choices, public webhook URL, Supabase project, tRPC console, and deterministic approval principle. It will not replace the architecture wholesale. The priority work is to make boundaries explicit, validate untrusted input, make delivery failure recoverable, turn the approval path into an auditable state machine, and make the bot operationally diagnosable.

## Visual Verification Finding

Unauthenticated preview captures show the intended authenticated-loading shell rather than owner data. This is expected because the console is deliberately admin-gated. Production owner-console validation must be performed through Kelvin’s authenticated session; no public preview should reveal conversations, memory, approvals, or health details.

## Audit Constraints

The production service is an event-driven webhook application with state stored in Supabase, so a managed request-based deployment remains appropriate. No polling worker or always-on process is required for the existing message flow. The audit found no reason to move platforms before the requested reliability and security improvements are implemented.

## Gap-Closure Evidence

| Requirement | Implemented control | Verification evidence |
| --- | --- | --- |
| Separation of concerns | Telegram validation, webhook event claims, conversation persistence, approval persistence, memory persistence, representative profile, risk policy, observability, and owner-console operations are dedicated server modules. `botService.ts` coordinates the inbound webhook only; owner queue, approval lifecycle, diagnostics, and setup actions live in `ownerOperationsService.ts`. | TypeScript validation and test suite passed after extraction. |
| Duplicate update handling | Webhook insertion is an atomic claim using Telegram’s unique `update_id`; a `409` conflict returns `DUPLICATE` and does not repeat downstream work. | `webhookEventRepository.test.ts` covers unique-conflict classification. |
| Telegram control boundary | The ingress schema normalizes supported updates, parses bounded command syntax, applies stable chat-ID allowlist policy when configured, and records callback queries as unsupported rather than executing callback data. | `telegramValidation.test.ts` covers command parsing and callback rejection. |
| Approval concurrency and lifecycle | A pending/non-expired row is atomically claimed as `SENDING`; terminal and expired items cannot be re-claimed. Lifecycle events are appended to `kr_approval_events`. | `botService.test.ts` covers claim eligibility; live `kr_approval_items` lifecycle constraint is verified. |
| Delivery recovery | A message is retried without threading only when Telegram explicitly reports that the original reply target is unavailable. Other Telegram failures remain visible as `SEND_FAILED`. | `telegram.test.ts` covers stale-target fallback and non-retryable provider failures. |
| Memory integrity | Archive records cannot be live verified; `CURRENT` state requires explicit live verification; live evidence has restricted sources; observed items require timestamps; expiry cannot precede recording. | `memoryPolicy.test.ts` plus live Supabase constraint verification. |
| Operational readiness | The public health route contains only redacted readiness fields. The authenticated console shows component readiness, latest event, failed-delivery count, and item lifecycle. | Local `GET /healthz` returned database and Telegram readiness `true`; owner data remains admin-gated. |

## Post-Upgrade Validation

The final validation completed with **11 test files and 39 passing assertions**. TypeScript completed without errors and the production bundle built successfully. The hardened Supabase schema contains `kr_approval_items_status_check` plus five memory integrity checks: archive/historical, current/live-verified, live/source, observed/timestamp, and expiry/recorded-at constraints.

## Remaining Risks Kept Explicit

The shared Supabase project still has unrelated legacy tables with RLS policy advisories; they were not modified because their owners and access intent are unknown. The frontend bundle also exceeds the 500 kB advisory threshold, which is a performance maintenance item rather than a reliability blocker for the webhook. Finally, dependency audit advisories remain a deliberate follow-up release: broad unreviewed dependency upgrades were not applied to a live representative system.

## Owner-Console Verification Note

The public owner-console boundary was verified: unauthenticated access is presented with the protected sign-in screen and no operational data is exposed. An authenticated owner session completed 62 console API batches. Redacted log checks explicitly confirmed HTTP `200` for `assistant.status` (health and webhook diagnostics), `assistant.approvals` (held and recoverable delivery queue), and `assistant.approvalEvents` (per-item lifecycle trail); the same session also read conversation, history, memory, and override data. The interactive browser later remained on Google’s stopped sign-in page after the external device challenge was denied, and a restart produced an `about:blank` identity-provider hand-off before the app regained control. This is an external identity-provider flow rather than an application data-exposure failure. Local `/healthz` returned database and Telegram readiness `true`, and Telegram `getMe` confirmed the configured bot identity. The standard owner-login recovery sequence is recorded in `PRODUCTION_RUNBOOK.md`.
