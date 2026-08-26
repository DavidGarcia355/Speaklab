# TryHabla HQ Admin Alerts

Habla Pulse is TryHabla's private founder/admin notification system. It is
disabled by default and must remain disabled until the Discord server,
destination webhooks, and sandbox checklist have been verified.

## Safety contract

- Product routes write only strict, typed, non-sensitive alert intents to the
  database. They never call Discord directly.
- Discord delivery failure cannot fail signup, class or assignment creation,
  submission, grading, feedback, or a verified Stripe business projection.
- Teacher, lead, and payment references are irreversible HMAC values. Email,
  names, organization names, student identifiers, classroom content, audio, transcripts, grades,
  Stripe IDs, raw webhook payloads, signed links, and secrets are prohibited.
- TryHabla for Schools alerts contain only an opaque lead reference and a
  protected admin path; business contact details stay behind TryHabla admin authentication.
- Discord mentions are disabled and user-supplied permitted text is escaped.
- Preview, Development, and Test can reach only
  `DISCORD_TEST_WEBHOOK_URL`. They cannot fall through to a production hook.

## Private server and destinations

Create a private server named **TryHabla HQ** with bot identity
**Habla Pulse**. Create one private webhook for each destination:

| Destination | Environment variable |
| --- | --- |
| Live traction | `DISCORD_TRACTION_WEBHOOK_URL` |
| Revenue | `DISCORD_REVENUE_WEBHOOK_URL` |
| Milestones | `DISCORD_MILESTONES_WEBHOOK_URL` |
| Daily/weekly pulse | `DISCORD_PULSE_WEBHOOK_URL` |
| Incidents | `DISCORD_INCIDENTS_WEBHOOK_URL` |
| Non-production bot testing | `DISCORD_TEST_WEBHOOK_URL` |

Webhook URLs are server-side secrets. Never paste them into source, logs,
screenshots, tickets, or chat. Rotate a hook immediately if it is exposed.

## Runtime controls

Set `DISCORD_ALERTS_ENV` explicitly per Vercel environment and keep
`DISCORD_ADMIN_ALERTS_ENABLED=false` during rollout. The switch controls only
network delivery; durable enqueue and deduplication continue while it is off.

Use a stable, random `DISCORD_ALERTS_REFERENCE_SECRET` of at least 32
characters. `AUTH_SECRET` is the fallback, but a dedicated stable secret avoids
changing internal references when auth credentials rotate. A reference-secret
rotation requires a duplicate-alert review before enablement.

`/api/cron/admin-alerts` runs every five minutes and requires `CRON_SECRET`.
It creates due summaries and milestones, checks outbox health, and leases
pending deliveries. Daily boundaries and weekly windows use
America/Chicago, including DST transitions. Vercel's schedule itself is UTC.

Operational checks use the current UTC-month provider spend against
`AI_MONTHLY_BUDGET_USD`, and a rolling 24-hour AI window. Provider-spend
incidents are deduplicated at 50%, 75%, 90%, and 100%. Delivery-success and
p95-latency incidents require at least 20 terminal samples. Set
`DISCORD_AI_P95_TARGET_MS` explicitly for production; it defaults to 60,000 ms.

## Stripe configuration

The verified billing webhook must subscribe to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `refund.created`

Billing alerts are built only after signature verification and the ordinary
local projection. The Stripe event ID is the alert dedupe key, and the event
marker plus alert intents are committed atomically. Alert enrichment failure
is logged with a fixed code and never blocks the verified billing event.

## Estimate definitions

- Teacher time saved: 2.5 minutes per successful unique AI review. This is a
  conservative product estimate, not measured teacher behavior.
- Provider spend: summed from recorded provider-request cost estimates.
- Stripe fees: estimated as 3.6% plus 30 cents per successful $20 subscription
  receipt (2.9% card processing plus 0.7% Billing). It is not a Stripe balance
  reconciliation and must be updated if TryHabla's Stripe contract changes.
- Estimated contribution: recognized receipts minus refunds, estimated Stripe
  fees, and measured provider cost. Fixed company costs remain separate.

## Enablement checklist

1. Confirm every TryHabla HQ channel and server role is private.
2. Store production hooks only in Vercel Production. Store only the bot-testing
   hook in Preview/Development/Test.
3. Confirm `DISCORD_ALERTS_ENV` agrees with each Vercel environment.
4. Subscribe the Stripe webhook to the seven events above.
5. In Preview, send one synthetic example of every allowed event type.
6. Replay the same inputs and verify no duplicate delivery.
7. Force timeouts, HTTP 429, HTTP 4xx, and HTTP 5xx. Confirm product and Stripe
   requests still succeed and outbox retries/dead-letter state is visible.
8. Inspect every Discord payload for prohibited identity, classroom, billing,
   and secret data.
9. Verify daily and weekly boundaries around both CST and CDT dates.
10. Verify 15/30, 30/30, 250/300, and 300/300 alerts fire once after delivered
    usage, not merely after an in-flight reservation.
11. Replay a Stripe webhook and prove it creates one alert set.
12. Turn the kill switch off and prove queued intents remain without network
    delivery. Turn it on only after all checks pass.

Do not enable production delivery merely because unit tests pass. The Discord
privacy settings, real webhook destinations, Stripe endpoint subscriptions,
and sandbox failure behavior are external controls and must be verified in the
connected accounts.
