# Kelvin Representative Operator Runbook

## Before Activation

The system has validated the supplied Telegram and Supabase credentials. All five protected configuration values must stay server-side:

| Secret | Purpose | Required |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Authenticates server-side Telegram Bot API calls. | Yes |
| `TELEGRAM_WEBHOOK_SECRET` | Must be a random 1–256-character token composed of `A-Z`, `a-z`, `0-9`, `_`, or `-`. It is checked on every Telegram webhook request. | Yes |
| `SUPABASE_URL` | Connects the backend to the BLACKTOWER NEXUS 3.0 project. | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Allows server-only persistence through Supabase while bypassing browser access. | Yes |
| `TELEGRAM_OWNER_CHAT_ID` | Receives a direct Telegram alert whenever a reply enters the approval queue. | Recommended |

## Production Activation

First create a project checkpoint. Then use the **Publish** button in the project interface to make the production HTTPS URL available. Do not register the temporary preview URL with Telegram.

After publishing, sign in to the owner console with the project owner account, open **Setup**, and select **Register verified webhook**. The console submits the production endpoint in the following form:

```text
https://your-published-domain/api/telegram/webhook
```

Telegram delivers JSON updates to that URL by HTTPS. The bot registers the supported update types (`message` and `business_message`) and includes the configured verification secret with each request. Telegram retry deliveries are made safe by the persisted unique `update_id`.[1]

## Safe Operating Mode

The default posture is **manual review**. Every draft appears in the approval queue until Kelvin explicitly approves or rejects it. After you observe stable output quality, you may enable **Low-risk auto-send** for ordinary, reversible messages. This never disables the deterministic safety gate.

| Incoming situation | Expected handling |
| --- | --- |
| Routine logistics with low risk | Drafted; it remains in the queue by default or may auto-send only if the low-risk setting is explicitly enabled. |
| Financial, legal, medical, security, access, confidential, disciplinary, or relationship commitment | Held automatically. Kelvin receives an alert and must approve/edit/reject. |
| A question that depends on Kelvin’s unverified current intent, availability, feeling, status, or plan | Held automatically as `UNKNOWN_CURRENT_STATE`. |
| Draft generation failure or malformed model result | Held automatically with a neutral clarification draft. |

## Adding Context

Use **Memory** only for information you can trace. Choose the appropriate layer and verification status. A `CURRENT` record should be live verified; when you cannot support a current claim, select `UNKNOWN`, `UNCERTAIN`, `CONFLICT`, or `HISTORICAL` instead. Archive-derived information must be stored as archive history and cannot be promoted to live verified state by the database.

Use **Setup → Current override** for temporary instructions such as boundaries, communication constraints, or active operational rules. An active owner override takes priority over historical archive context. Deactivate it when it no longer applies.

## References

[1]: https://core.telegram.org/bots/api "Telegram Bot API — setWebhook and Update"
