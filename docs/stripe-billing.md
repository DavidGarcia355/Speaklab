# Stripe teacher AI billing

Habla's Stripe catalog and runtime billing use the versioned `TEACHER_AI_PRICE_BOOK` in
`lib/teacher-ai-pricing.ts`. Do not copy the launch rates into another script or configuration
file.

| Meter event | Stripe quantity | Decimal cents per unit | Published rate |
| --- | --- | ---: | ---: |
| `habla_ai_successful_grade` | One valid, unique AI result | `1` | $0.01 per successful grade |
| `habla_ai_audio_seconds` | Whole processed audio seconds | `0.016666666667` | $0.01 per audio minute |
| `habla_ai_feedback_tokens` | Whole final-feedback output tokens | `0.0005` | $0.005 per 1,000 tokens |

All three Billing Meters aggregate with `sum`. Audio is reported as integer seconds; its Price is
the per-minute rate divided by 60 and rounded half-up to Stripe's 12-decimal minor-unit limit.

Stripe [recommends Billing with Metronome for new usage-based billing
integrations](https://docs.stripe.com/billing/subscriptions/usage-based/how-it-works). Habla is
deliberately keeping Stripe Billing Meters for this MVP: the local ledger provides semantic
idempotency, free-credit allocation, and at-most-once delivery claims for three small SUM streams. Revisit
Metronome before materially increasing billing volume or contract complexity.

## Provision the test catalog

Keep billing disabled while provisioning:

```dotenv
STRIPE_BILLING_ENABLED=false
STRIPE_TEST_SECRET_KEY=sk_test_...
```

`STRIPE_TEST_SECRET_KEY` is used only by the catalog command. It must belong to the same Stripe
test/sandbox account that the runtime will use. The command rejects live keys and live resources.

Plan first; this is read-only:

```bash
npm run stripe:catalog:plan
```

Apply the plan to test mode:

```bash
npm run stripe:catalog:test:apply
```

Run the plan again. Every meter, Product, and Price must report `unchanged`:

```bash
npm run stripe:catalog:plan
```

Copy the three printed test **Price** IDs, not Product or Meter IDs, into these exact runtime keys:

```dotenv
STRIPE_AI_GRADE_PRICE_ID=price_...
STRIPE_AI_AUDIO_SECONDS_PRICE_ID=price_...
STRIPE_AI_FEEDBACK_TOKENS_PRICE_ID=price_...
```

The setup command can reconcile mutable Product and meter display fields. Prices are immutable: a
different amount, currency, meter, recurrence, Product, lookup key, or price-book metadata fails
closed. Publish a new price-book version instead of modifying an existing Price.

## Configure the test runtime and local webhook

Set the runtime secret to a standard test secret from the same Stripe account. The runtime accepts
`sk_test_...`; it does not read `STRIPE_TEST_SECRET_KEY`:

```dotenv
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_AUTOMATIC_TAX_ENABLED=false
STRIPE_ALLOW_LIVE=false
STRIPE_BILLING_ENABLED=false
```

Authenticate the Stripe CLI to that test account, then leave this listener running while testing
locally:

```bash
stripe login
stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted --forward-to http://localhost:3000/api/billing/webhook
```

Copy the listener's printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`. That signing secret belongs
to this local listener. A deployed test environment needs a Stripe test-mode webhook endpoint at
`https://<deployment>/api/billing/webhook` and that endpoint's own signing secret.

Configure the Stripe Customer Portal in test mode as well. After the catalog, all three Price IDs,
runtime test key, webhook secret, and Portal are ready, set the enable flag **last** and restart the
app:

```dotenv
STRIPE_BILLING_ENABLED=true
```

For local testing, set `NEXTAUTH_URL=http://localhost:3000`. In production, replace it with the exact
canonical HTTPS deployment origin; Checkout and Portal return URLs are built from this value. Before
enabling Checkout, also verify `AI_GRADING_ENABLED=true`, `AI_ACCESS_MODE=paid`, a working
transcription/grading provider, and (in production) `AI_STUDENT_DATA_APPROVED=true`. The status API
keeps Checkout disabled until both Stripe and these AI prerequisites are ready.

With the flag false or with incomplete configuration, status remains available but Checkout and
Portal fail closed with `503`; core Habla remains available.

## Runtime behavior

- `GET /api/billing/status` requires a signed-in teacher. It returns safe configuration mode,
  price-book version, access/subscription state, the subscription period end when Stripe is
  reachable, and current UTC-month local usage, free credits, and estimated retail charge. It never
  returns secrets or Price IDs. The estimate is the local ledger view, not a Stripe invoice.
- `POST /api/billing/checkout` requires a signed-in teacher and a complete billing configuration.
  It refuses an already active or trialing subscription, reuses or idempotently creates the Stripe
  Customer, and opens hosted subscription Checkout with the three configured metered Prices. Stripe
  returns to `/billing?checkout=success` or `/billing?checkout=cancelled`.
- `POST /api/billing/portal` requires a signed-in teacher with a mapped Stripe Customer and opens
  the hosted Customer Portal, returning to `/billing`.
- `POST /api/billing/webhook` verifies the `Stripe-Signature` against the unmodified body. It handles
  `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, and `customer.subscription.deleted`. Before projecting access,
  it validates teacher identity, Customer mapping, price-book metadata, and the exact set of three
  configured Prices. Event IDs are recorded idempotently; a duplicate returns success, while a
  projection failure returns `500` so Stripe can retry. Invoice events are not projected by this
  MVP.

The `/billing` page uses those APIs to show inactive, manual-pilot, active, or trialing access;
redirect to Checkout; open the Portal; and display local monthly usage. Card details remain hosted
by Stripe.

## What becomes billable

Automatic grading records one logical result only when all of these conditions hold:

- a completed attempt delivered a valid scored result and was not marked unable to grade;
- the pipeline has no failure code;
- the result is neither a cache hit nor a deterministic result;
- the result has a cache key and is unique for teacher + cache key + price-book version; and
- the teacher has an active or trialing Stripe subscription on the current price book.

That one result contributes one base unit, rounded-up whole audio seconds, and truncated whole final
output-token units. Provider retries, formatting retries, and escalation are internal work for the
same logical result and do not create extra units. Cache hits, deterministic grades, duplicate
delivery calls, failed attempts, and unable-to-grade results are free. A billing delivery failure
never removes or blocks the grade already shown to the teacher.

## Qualifying-class free credits

Credits follow `qualifying_classes_minus_one` for each UTC calendar month:

- A class qualifies when it is active, has at least one roster member, and has at least one active
  assignment.
- The month's credit allowance is `max(0, qualifying-class high-water mark - 1)`. The high-water
  mark prevents credits already earned in the month from shrinking if a class later stops
  qualifying.
- Each credit covers one entire eligible AI result: base grade, audio, and feedback tokens. A
  credited result is written to the local ledger but emits no Stripe meter events.
- Credits do not roll over. The first eligible unique results consume the available monthly
  credits.

## Usage outbox and recovery

The local `ai_billing_usage` table is the durable usage outbox. Each dimension has a stable Stripe
identifier plus attempted and reported timestamps. Habla atomically claims a dimension before the
network call. If the process stops or the network outcome is ambiguous, that claim is not retried
automatically: Stripe only guarantees identifier uniqueness for a rolling period of at least 24
hours, so a blind later retry could double-charge. Reconcile an ambiguous claim against Stripe and
either mark it reported or create a deliberate correction; the safe default is to undercharge.

Completed billable attempts also carry a durable marker. The daily Vercel cleanup cron calls
`GET /api/cron/cleanup` at `02:00 UTC` (`0 2 * * *`) and first reconstructs any missing local usage
row, then flushes only dimensions that have never been attempted. The route requires `CRON_SECRET` via
`Authorization: Bearer ...` or `x-cron-secret` and includes attempted/reported/failed billing counts
in its response. Monitor failed or attempted-without-reported rows for manual reconciliation.

## Test-mode launch checklist

Do not enable live billing until every item passes in one Stripe test/sandbox account:

1. Leave `STRIPE_BILLING_ENABLED=false`; set that account's `STRIPE_TEST_SECRET_KEY`.
2. Run `npm run stripe:catalog:plan`, then `npm run stripe:catalog:test:apply`, then the plan again.
   The final plan must show all resources as `unchanged`.
3. Copy the printed test Price IDs into `STRIPE_AI_GRADE_PRICE_ID`,
   `STRIPE_AI_AUDIO_SECONDS_PRICE_ID`, and `STRIPE_AI_FEEDBACK_TOKENS_PRICE_ID` without reordering
   them.
4. Set `STRIPE_SECRET_KEY` to the matching `sk_test_...`; configure the test Customer Portal; start
   the four-event Stripe CLI listener; and set its `whsec_...` as `STRIPE_WEBHOOK_SECRET`.
5. Run the focused offline suite:

   ```bash
   npm test -- __tests__/stripe-catalog.test.ts __tests__/stripe-runtime.test.ts __tests__/stripe-persistence.test.ts __tests__/stripe-metering.test.ts __tests__/billing-routes.test.ts
   ```

6. Set `NEXTAUTH_URL=http://localhost:3000`, prove a complete AI grading request works, then start the
   app, set `STRIPE_BILLING_ENABLED=true` last, sign in as a test teacher, and open
   `/billing`. Status must say Stripe test mode and Checkout must use Stripe's hosted test flow.
7. Complete Checkout with a Stripe test payment method. Confirm the CLI forwards a successful
   `checkout.session.completed`, the three-Price subscription is projected as active/trialing, and
   `/api/billing/status` reflects it. Open the Customer Portal and return successfully.
8. Produce a new valid AI grade. Verify one local ledger row, the expected non-credited meter events,
   and matching status totals. Repeat/cache the same result and exercise deterministic, retry,
   failed, and unable-to-grade paths; none may add a second logical charge.
9. Verify a teacher with qualifying classes receives exactly `classes - 1` whole-result credits in
   the UTC month and that credited rows produce no Stripe meter events.
10. Interrupt one test meter delivery after its local claim. Call the authorized cleanup route and
    verify that ambiguous dimension is not sent again. Reconcile it in Stripe before applying any
    manual correction. Also simulate a process stop after attempt persistence but before usage-row
    creation; the next cleanup run must reconstruct exactly one semantic usage row.
11. In Stripe test mode, allow meter aggregation to settle and preview/finalize a test invoice (or
    advance a Test Clock). Reconcile each invoice quantity and amount against the local ledger and
    the three published rates, including zero Stripe usage for credited results. Record the evidence
    before considering live activation.

## Live-mode guard

The runtime rejects an `sk_live_...` key unless both conditions are true:

```dotenv
NODE_ENV=production
STRIPE_ALLOW_LIVE=true
```

That is only a technical guard, not a go-live recommendation. Keep `STRIPE_ALLOW_LIVE=false` and do
not provision or enable live billing until the complete test-mode checklist passes and a finalized
test invoice has been reconciled to the local ledger. Live catalog creation, tax configuration,
webhook registration, operational alerting, and rollback approval require a separate production
change.
