# KELVIN REPRESENTATIVE™ Production Runbook

## Release Standard

The production release is an event-driven Telegram webhook service. Telegram delivers updates to the published HTTPS endpoint, the backend verifies Telegram’s secret header, creates an idempotent event record, retrieves controlled context, and either sends a routine reply or creates an owner-controlled approval item. Telegram documents the webhook secret header and retry-compatible `update_id` mechanism in its Bot API reference.[1]

## Configuration Contract

| Setting | Role | Production requirement |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Server-to-Telegram authorization | Required. Never expose to the browser, logs, client bundle, or source control. |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook request authentication | Required. Use a random 1–256-character `A-Z`, `a-z`, `0-9`, `_`, or `-` token. |
| `SUPABASE_URL` | Server-side database endpoint | Required. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side privileged persistence | Required. It must never cross the tRPC or browser boundary. |
| `TELEGRAM_OWNER_CHAT_ID` | Direct owner approval alert | Recommended. Use the stable numeric Telegram chat ID, not a username. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Optional comma-separated contact allowlist | Leave empty to allow normal representative conversations; set it only when the representative should operate for a closed contact set. |
| `EXTERNAL_REQUEST_TIMEOUT_MS` | Telegram/Supabase request bound | Optional; defaults to `10000`. Keep between 1,000 and 30,000 milliseconds. |
| `APPROVAL_EXPIRY_HOURS` | Lifetime of a pending owner decision | Optional; defaults to `72`. |
| `FEATURE_AUTO_REPLY_ENABLED` | Emergency server-side auto-send gate | Optional; defaults to `true`. Set to `false` to force all messages into review without disabling receipt and persistence. |

## Deployment and Verification

After a release is published, register the production webhook from the authenticated **Setup** console. The endpoint must use the published HTTPS domain:

```text
https://kelvinbot-cxsk7qzu.manus.space/api/telegram/webhook
```

The public `GET /healthz` endpoint exposes only redacted readiness information. It returns `200` when Supabase and Telegram are reachable and the webhook secret and timeout configuration are valid; it returns `503` otherwise. The owner console gives the same status together with the last webhook-event timestamp and the count of recoverable delivery failures.

## Normal Operating Procedure

| Situation | Expected operator action |
| --- | --- |
| Routine, low-risk message | The bot may reply automatically only if both the database setting and `FEATURE_AUTO_REPLY_ENABLED` permit it. |
| Enquiry, task, decision, authorization, uncertainty, or high-risk subject | Review it in **Approvals**. The user receives a short, Kelvin-native waiting response, but no decision is auto-sent. |
| Approval item | Edit if needed, then select **Approve & send**. The item atomically moves to `SENDING`, then `SENT` when delivery and persistence complete. |
| `SEND_FAILED` item | Check the lifecycle evidence, correct the draft or context if necessary, and select **Retry delivery** deliberately. The system attempts a safe unthreaded fallback only when Telegram reports the original reply target is unavailable. |
| Stale item | Items pass to `EXPIRED` once their expiry is reached and cannot be sent. Create a new decision if the matter remains live. |
| Bot needs to stop auto-sending | Disable **Low-risk auto-send** in **Setup** or set the server-side feature flag to `false`. |

## Incident Response

> **Do not troubleshoot through user-facing Telegram messages. First stop the unsafe path, preserve the audit trail, then decide the recovery action.**

For suspicious incoming messages, leave the approval gate enabled. If the bot is sending inappropriately, turn off low-risk auto-send immediately; inbound events and drafts will continue to be recorded for review. If the webhook secret or token might be compromised, rotate the Telegram secret/token at the provider, update the server-side setting, restart the service, and register the webhook again. Review `kr_webhook_events`, `kr_messages`, `kr_approval_items`, and `kr_approval_events` by correlation ID and timestamp. Application logs are structured and redact message, token, secret, authorization, cookie, and payload fields.

The shared Supabase project has security and performance advisories on unrelated legacy tables. They are documented in `PRODUCTION_AUDIT.md` and were not changed because their intended access model is outside this bot’s ownership. The remaining dependency-audit advisories also remain a tracked platform/template risk; treat dependency upgrades as a separately tested maintenance release rather than applying broad unreviewed updates to the live representative.

## Owner Console Login Recovery

The owner console is intentionally protected by the project OAuth login. During final verification, the browser reached Google’s **Verify it’s you** challenge before it could return to the application. This may appear as a blank page or stalled hand-off, but it is an identity-provider challenge rather than a Telegram bot, webhook, or console-rendering failure.

Open the published domain in a normal browser session and select **Sign in**. Complete the Google approval on the registered phone, then return to the same browser tab or reopen the published domain. Do not change the Telegram webhook, bot token, or Supabase settings to troubleshoot this identity prompt. If the identity-provider page remains blank after completing the phone challenge, start a fresh sign-in from the published domain in a normal browser window; the Telegram webhook and server-side health route remain unaffected.

The owner API boundary has been exercised by an authenticated session without exposing console data publicly. Redacted request evidence confirms HTTP `200` for `assistant.status` (health and webhook diagnostics), `assistant.approvals` (held and recoverable delivery items), and `assistant.approvalEvents` (lifecycle evidence), as well as the related history, memory, and override reads. The automated browser may still show a stopped Google sign-in page if its separate device challenge was denied; that browser state does not affect Telegram delivery.

## References

[1]: https://core.telegram.org/bots/api#setwebhook "Telegram Bot API — setWebhook and Update"
