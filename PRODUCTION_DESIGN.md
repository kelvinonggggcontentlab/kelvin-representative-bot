# KELVIN REPRESENTATIVE™ Production Upgrade Design

## Target Architecture

```text
Telegram HTTPS update
  → webhook secret verification + Zod normalization + correlation ID
  → event claim (unique update ID)
  → conversation/message repository
  → controlled context retrieval
  → deterministic risk policy + structured AI decision
  → auto reply OR held approval workflow
  → owner alert + immutable approval event
  → structured, redacted operational logs
```

| Boundary | Module responsibility | Trust level |
| --- | --- | --- |
| `server/_core/env.ts` | Parse central configuration, stable owner identity, feature flags, and safe readiness state. | Server-only trusted configuration. |
| `server/observability.ts` | Generate correlation IDs and emit structured, redacted lifecycle logs. | No credentials or message bodies. |
| `server/telegram.ts` | Verify webhook secret using constant-time comparison, normalize Bot API errors, and send/retry only when safe. | Telegram API boundary. |
| `server/telegramValidation.ts` | Validate untrusted Telegram request shapes and classify supported update messages. | Untrusted update input. |
| `server/supabase.ts` | Apply timeout, error classification, redaction, and GET-only bounded retries to the database boundary. | Server-only data access. |
| `server/representativeProfile.ts` | Store Kelvin Representative’s versioned behavioural baseline, forbidden generic language, and approved wait templates. | Owner-controlled profile configuration. |
| `server/representative.ts` | Retrieve compact scoped context, run deterministic risk checks, call the structured-output model, and fail closed. | Decision support, never final authority. |
| `server/botService.ts` | Orchestrate event claim, persistence, safe reply dispatch, approval lifecycle, and operator queries. | Business workflow. |
| `server/routers/*` | Separate owner-console APIs by domain; every mutation remains admin-gated and Zod validated. | Authenticated owner only. |

## Safety Decisions

Archive material remains labelled historical and cannot become live verified context through retrieval. Telegram message content is treated as untrusted data; it is never allowed to alter system instructions, profile rules, credentials, access policy, or workflow routing. A deterministic risk policy can only increase restrictions; the model cannot downgrade a hold.

The bot remains publicly reachable to legitimate Telegram contacts so it can act as a representative. This is distinct from administrative authority. Administrative actions stay behind authenticated owner-console procedures; only the stable `TELEGRAM_OWNER_CHAT_ID` may receive owner-oriented bot status information. Usernames and display names are never used for authorization.

## Approval Lifecycle

| State | Meaning | Permitted transition |
| --- | --- | --- |
| `PENDING` | Draft needs Kelvin’s decision. | `SENDING`, `REJECTED`, or `EXPIRED` |
| `SENDING` | One owner has claimed the item; another approval cannot send it. | `SENT` or `SEND_FAILED` |
| `SENT` | Final reply was sent and persisted. | Terminal |
| `REJECTED` | Kelvin declined the proposed reply. | Terminal |
| `EXPIRED` | The item is stale and cannot send. | Terminal |
| `SEND_FAILED` | Telegram delivery did not succeed after the safe fallback. | Owner-visible recovery required |

The database migration adds the lifecycle columns, immutable approval-event audit trail, and the missing foreign-key indexes identified by the performance advisor. It changes no historical message content and creates no destructive operations.

## Reliability Rules

The webhook claim is insert-only and unique by `telegram_update_id`, so duplicate deliveries return success without reprocessing. The database adapter uses bounded timeouts and only retries idempotent read requests. Telegram send operations are not blindly retried; where Telegram rejects a reply target as stale, the adapter performs one deliberate, unthreaded fallback delivery. All remaining transport or persistence uncertainty becomes a recorded error state rather than a duplicate outbound message.

## Google Drive Boundary

The shared Supabase project contains a Drive reference index, but the web application does not currently have an independently configured server-side Drive sync credential. The upgrade can retrieve only approved metadata references from the existing index, labelled `ARCHIVE` and never as live state. It does not fabricate a Drive-sync feature. A future sync job requires a separately configured server-side Google Drive integration and scoped document-access policy.
