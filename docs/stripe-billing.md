# Stripe teacher AI billing

Habla's Stripe catalog and runtime billing use the versioned `TEACHER_AI_PRICE_BOOK` in
`lib/teacher-ai-pricing.ts`. Do not copy the launch rates into another script or configuration
file. The active contract is `habla-teacher-ai-usd-v2`: 5 cents per successful grade plus 1 cent
per processed audio minute. Feedback is included and has no separate retail token charge. Its
successful-grade identity is versioned as `teacher_assignment_recording` and is part of the catalog
fingerprint.

| Meter event | Stripe quantity | Decimal cents per unit | Published rate |
| --- | --- | ---: | ---: |
| `habla_ai_successful_grade` | One valid, unique AI result | `5` | $0.05 per successful grade |
| `habla_ai_audio_seconds` | Whole processed audio seconds | `0.016666666667` | $0.01 per audio minute |

Both Billing Meters aggregate with `sum`. Audio is reported as integer seconds; its Price is
the per-minute rate divided by 60 and rounded half-up to Stripe's 12-decimal minor-unit limit.
There is no feedback-token Meter or Price in v2. Recordings and the pricing calculator's average
recording input are capped at five minutes (300 seconds); billing uses actual processed seconds.

Stripe [recommends Billing with Metronome for new usage-based billing
integrations](https://docs.stripe.com/billing/subscriptions/usage-based/how-it-works). Habla is
deliberately keeping Stripe Billing Meters for this MVP: the local ledger provides semantic
idempotency, free-credit allocation, and at-most-once delivery claims for two small SUM streams. Revisit
Metronome before materially increasing billing volume or contract complexity.

## v1 prerequisite and migration boundary

The current runtime supports one active price book and one exact set of configured Stripe Prices;
it is not a dual-version subscription migrator. A hard prerequisite for activating v2 is that v1
never had live subscriptions or live billable usage.

The Habla application database has been checked and no live v1 subscriptions or usage were found.
That database check does not prove what exists in Stripe. Before any live setup, manually verify in
the Stripe Dashboard that v1 has no live subscriptions, invoice items, meter events, or usage. Record
that verification with the launch evidence. If any v1 live state exists, stop: do not point the
runtime at v2 Price IDs until a reviewed subscription and usage migration has been implemented and
invoice-reconciled.

Old v1 test Products, Prices, or meters may remain in Stripe test mode because Stripe Prices are
immutable. They must not be copied into the v2 runtime variables. A v2 subscription must contain
exactly the two v2 Prices documented below.

## Provision the test catalog

Keep billing disabled while provisioning:

```dotenv
STRIPE_USAGE_BILLING_ENABLED=false
STRIPE_CHECKOUT_ENABLED=false
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_ACCOUNT_ID=acct_...
```

`STRIPE_TEST_SECRET_KEY` is used only by the test setup commands. It must belong to the same Stripe
test/sandbox account that the runtime will use. Record that account's exact `acct_...` ID in
`STRIPE_ACCOUNT_ID`; every setup command verifies that identity before listing or writing account
resources, and runtime catalog validation independently verifies it. These ordinary setup commands
reject live keys and live resources. The separately armed live command is documented only in the
live activation checklist and has additional independent read and mutation gates.

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

Copy the two printed v2 test **Price** IDs, not Product or Meter IDs, into these exact runtime keys.
Both IDs must come from the same Stripe test/sandbox account as the runtime test key:

```dotenv
STRIPE_AI_GRADE_PRICE_ID=price_...
STRIPE_AI_AUDIO_SECONDS_PRICE_ID=price_...
```

The setup command is intentionally test-only and rejects live keys. It can reconcile mutable Product
and meter display fields in test mode. Prices are immutable: a
different amount, currency, meter, recurrence, Product, lookup key, or price-book metadata fails
closed. Publish a new price-book version instead of modifying an existing Price.

## Configure the test runtime and local webhook

Set the runtime secret to a test or sandbox secret from the same Stripe account. The runtime accepts
`sk_test_...`, `rk_test_...`, and Stripe's restricted `rkcs_test_...` sandbox form; it does not read
`STRIPE_TEST_SECRET_KEY`:

```dotenv
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_ACCOUNT_ID=acct_...
STRIPE_PAYMENT_METHOD_CONFIGURATION_ID=pmc_...
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
STRIPE_AUTOMATIC_TAX_ENABLED=false
STRIPE_ALLOW_LIVE=false
STRIPE_USAGE_BILLING_ENABLED=false
STRIPE_CHECKOUT_ENABLED=false
```

Authenticate the Stripe CLI to that test account. The listener uses the account's default payload
API version unless told to use another source, so first require that default (or the configured
webhook loaded by the listener) to be exactly `2026-07-29.dahlia`; do not use `--latest` unless its
delivered-event evidence resolves to that exact version. Then leave this listener running while
testing locally:

```bash
stripe login
stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted --forward-to http://localhost:3000/api/billing/webhook
```

Copy the listener's printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`. That signing secret belongs
to this local listener. A deployed test environment needs a Stripe test-mode webhook endpoint at
`https://<deployment>/api/billing/webhook`, explicitly configured to the same exact
[webhook API version](https://docs.stripe.com/webhooks/versioning), and that endpoint's own signing
secret.
For both the CLI listener and the deployed endpoint, inspect a delivered Event and require its
`api_version` to equal the runtime's exact `STRIPE_API_VERSION`, currently
`2026-07-29.dahlia`. Save the listener/endpoint configuration and delivered-event evidence; a
different payload version is a launch blocker even if signature verification succeeds.
Vercel Preview Protection blocks ordinary Stripe deliveries; use the local Stripe CLI listener or
a separately controlled staging endpoint/protection-bypass URL. Never point a sandbox webhook at
the production endpoint, and never place a live Stripe key in Preview scope.

First plan and apply the exact card-only Payment Method Configuration in the same test account:

```bash
npm run stripe:payment-methods:plan
npm run stripe:payment-methods:test:apply
npm run stripe:payment-methods:plan
```

The final plan must reuse an exact active configuration: card's effective
`display_preference.value` is `on`, and every surfaced non-card method is `off`. Copy the printed
`pmc_...` ID into both `STRIPE_PAYMENT_METHOD_CONFIGURATION_ID` and the tooling-only
`STRIPE_TEST_PAYMENT_METHOD_CONFIGURATION_ID`. The command is read-only unless `--apply` is
present, verifies `STRIPE_ACCOUNT_ID` before listing or writing, and cannot mutate live mode.

Then plan and apply the versioned Customer Portal v3 contract:

```bash
npm run stripe:portal:plan
npm run stripe:portal:test:apply
npm run stripe:portal:plan
```

The final plan must reuse the exact active configuration. Copy its printed `bpc_...` value into
`STRIPE_PORTAL_CONFIGURATION_ID`. Portal setup remotely verifies both the exact account and the
exact active card-only `pmc_...` before any Portal write. The v3 contract pins the configuration
name, `https://tryhabla.com/billing` default return URL, Habla headline, canonical privacy and terms
URLs, hosted login page, card recovery, invoice history, address/name/tax-ID updates, and
cancellation at period end without proration; it disables subscription plan updates and carries
exact Habla role/version metadata. The setup command is idempotent, read-only without `--apply`, and
rejects live keys. In
the same Stripe mode, also enable Stripe's
[one-subscription limit](https://docs.stripe.com/payments/checkout/limit-subscriptions) in
**Checkout and Payment Links settings** and select the Customer Portal redirect. Keep the Portal
login link enabled: turning it off also disables that Dashboard protection. This is defense in
depth for the application's own subscription and open-Checkout checks. After the catalog, both
Price IDs, runtime test key, webhook secret, and Portal are ready, enable usage first and Checkout
**last**, then restart the app:

```dotenv
STRIPE_USAGE_BILLING_ENABLED=true
STRIPE_CHECKOUT_ENABLED=true
```

For local testing, set `NEXTAUTH_URL=http://localhost:3000`. In production, replace it with the exact
canonical HTTPS deployment origin; Checkout and Portal return URLs are built from this value. Before
enabling Checkout, also verify `AI_GRADING_ENABLED=true`, `AI_ACCESS_MODE=paid`, a working
transcription/grading provider, and (in production) the current versioned
`AI_STUDENT_DATA_APPROVED` attestation documented in `docs/environment-variables.md`. The status API
keeps Checkout disabled until both Stripe and these AI prerequisites are ready.

With Checkout disabled or with incomplete catalog configuration, status remains available and new
Checkout fails closed. Portal uses a separate protected capability: the client credential plus a
pinned, remotely verified configuration in the mapped account's Stripe mode. It remains independent
of Checkout and usage flags, so a mapped customer can still update payment details or cancel while
acquisition or usage is paused. Keep the client key, Portal configuration ID, webhook secret, and
signed webhook endpoint operational for the full lifetime of every subscription.

## Immutable account and billing contract

Every remotely trusted Stripe read is bound to the exact configured `STRIPE_ACCOUNT_ID`. Habla also
derives a SHA-256 billing-contract ID from that account, the pinned Stripe API version and mode,
price-book ID and catalog fingerprint, exact Price IDs, the false-only tax policy, and the
`card_only_v1` Checkout policy. The derived ID is not an environment variable and must never be
manually copied or overridden.

Customer/subscription projections, grading billing markers, and v3 usage rows record that immutable
contract. A key/account mismatch or a change to account, catalog, Prices, tax policy, or payment
policy therefore fails closed instead of silently inheriting entitlement or sending old-contract
usage. Subscription and Checkout metadata carry the same account and contract identity. Only a
subscription whose current remote state is exactly `active` and matches the entire contract grants
Stripe-derived access; `trialing`, `past_due`, `unpaid`, incomplete, paused, canceled, malformed,
and foreign-contract subscriptions are non-entitled.

## Runtime behavior

- `GET /api/billing/status` requires a signed-in teacher. It returns safe configuration mode,
  price-book version, access/subscription state, the subscription period end when Stripe is
  reachable, and current UTC-month local usage, free credits, and estimated retail charge. It never
  returns secrets or Price IDs. The estimate is the local ledger view, not a Stripe invoice.
- `POST /api/billing/checkout` requires a signed-in teacher, both explicit enable flags, billing
  storage readiness, a remotely verified v2 catalog, and the pinned Portal configuration verified
  with the card-only Payment Method Configuration in the same Stripe account and mode. It checks
  those prerequisites and validates both configured Prices, Products, and Meters before creating a
  Customer or Session. It audits relevant Customers, subscriptions, and open/completed Sessions;
  restores only remotely proved exact identities; refuses any nonterminal Habla subscription; and
  opens card-only hosted subscription Checkout with the two configured metered Prices. Stripe
  returns to `/billing?checkout=returned` or
  `/billing?checkout=cancelled`; that query is only a navigation hint. The page waits for signed
  webhook projection before claiming access is active.
- `POST /api/billing/portal` requires a signed-in teacher whose mapped Stripe Customer mode matches
  the deployment. It remotely validates and explicitly pins the active versioned Portal
  configuration before creating a hosted session that returns to `/billing`.
- `POST /api/billing/webhook` verifies the `Stripe-Signature` against the unmodified body. It handles
  `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, and `customer.subscription.deleted`. Before projecting access,
  it validates account/contract identity, teacher identity, Customer mapping, price-book metadata,
  tax policy, payment collection mode, and the exact set of two configured Prices and remotely
  verified catalog fingerprint. Any state other than an exact current `active` contract is
  non-entitled. Signed non-entitled events can revoke access even during a Stripe account-read
  outage; a later remote reconciliation remains retryable. Unrelated account-wide subscription
  events are ignored safely. Event IDs are recorded
  idempotently; a duplicate returns success, while a Habla projection failure returns `500` so
  Stripe can retry. Invoice events are not projected by this MVP.

The `/billing` page uses those APIs to show inactive, manual-pilot, or active access;
redirect to Checkout; open the Portal; and display local monthly usage. Card details remain hosted
by Stripe.

## What becomes billable

Automatic grading records one logical result only when all of these conditions hold:

- a completed attempt delivered a valid scored result and was not marked unable to grade;
- the pipeline has no failure code;
- the result is not deterministic; whether its provider response was served from cache does not by
  itself decide billing;
- the result has a delivery key derived from its assignment grading identity, normalized audio
  content type, and exact recording bytes, and is unique for teacher + delivery key + exact
  price-book ID + catalog fingerprint + Stripe mode; and
- usage billing is enabled, billing storage is ready, and the remotely verified v2 catalog and
  immutable account/contract scope are healthy; and
- the teacher has an exact `active` Stripe subscription on that current contract.

That one result contributes one base unit and rounded-up whole audio seconds. Feedback is included
in the successful-grade price. Provider retries, formatting retries, and escalation are internal
work for the same logical result and do not create extra units. The first successfully delivered
teacher/assignment/recording result may be billable even when text grading reused a cached provider
response. An exact retry of the same recording for the same teacher and assignment has the same
delivery identity and adds no units. Different recording bytes or normalized content type produce
a distinct billing identity and can be billed separately even when the transcript and cached
text-grade result are the same. Deterministic grades, failed attempts, and unable-to-grade results are free. The grade
and immutable billing marker are saved atomically; after that commit, a later Stripe meter-delivery
failure never removes the grade already shown to the teacher.

## Qualifying-class free credits

Credits follow capped `qualifying_classes_minus_one` for each UTC calendar month. Only the first 30
qualifying classes count, so the allowance can never exceed 29 whole-result credits:

- A class qualifies when it is active, has at least one roster member, and has at least one active
  assignment.
- The month's credit allowance is
  `max(0, min(qualifying-class high-water mark, 30) - 1)`. The capped high-water mark prevents
  credits already earned in the month from shrinking if a class later stops qualifying.
- Each credit covers one entire eligible AI result: base grade, audio, and included feedback. A
  credited result is written to the local ledger but emits no Stripe meter events.
- Credits do not roll over. The first eligible unique results consume the available monthly
  credits.

## Ledger scope and legacy quarantine

The active ledger uses `ai_billing_credit_periods_v3` and `ai_billing_usage_v3`. Usage rows record
the immutable billing-contract ID in addition to teacher, UTC month, the recording-derived delivery
key, price-book ID, catalog fingerprint, Stripe Customer/subscription, and `livemode`. Automatic
reads and deliveries select only the current contract. Semantic uniqueness deliberately remains
teacher + recording-derived delivery key + price book + catalog fingerprint + mode across contract
changes, so changing an account, Price ID, tax policy, or card policy cannot bill an exact
teacher/assignment/recording retry again. Monthly credit identity also
remains teacher + month + catalog + mode, preserving the published capped `classes - 1` allowance
across a contract cutover rather than resetting credits.

The unversioned and v2 credit/usage tables remain untouched as audit quarantine. They cannot be
safely upgraded in place because their old primary-key/unique constraints do not contain the new
account/contract information. Any row in any legacy table, any account or billing marker missing
its account/contract scope, or any v3 usage row missing its contract makes billing storage unready:
new Stripe-derived access, Checkout, billing markers, automatic delivery, and billing-source
retention cleanup stay fail-closed. Never guess legacy scope, copy legacy rows into v3, or delete
them merely to clear the health check. Reconcile them to Stripe and a restorable backup through a
separately reviewed migration.

## Usage outbox and recovery

The local `ai_billing_usage_v3` table is the durable usage outbox. In price book v2, only the base
and audio dimensions are customer-billable; the billing row stores zero output units because
feedback is included. Each billable dimension has a stable Stripe identifier that includes the
exact catalog and test/live scope, plus attempted and reported timestamps. Habla atomically claims
a dimension before the network call. If the process stops or the network outcome is ambiguous,
that attempted claim is not retried automatically. Reconcile an ambiguous claim against Stripe and
either mark it reported or create a deliberate correction; the safe default is to undercharge.

Completed billable attempts also carry a durable marker. A disabled or unhealthy usage runtime
never writes that marker, including when the teacher separately has a manual pilot grant, so a
later re-enable cannot retroactively turn paused usage into a charge. The daily Vercel cleanup cron calls
`GET /api/cron/cleanup` at `02:00 UTC` (`0 2 * * *`) and first reconstructs any missing local usage
row from the original result timestamp only while it is at most 34 days old, then flushes only
dimensions that have never been attempted and remain inside a 34-day window. Stripe accepts meter
events from the past 35 calendar days; Habla keeps a full-day margin for clock and daily-cron drift.
The shorter identifier-deduplication horizon does not apply to these first, never-attempted
deliveries because no prior Stripe request could share the identifier. A dimension with any durable
attempt timestamp remains manual reconciliation work at every age and must never be auto-replayed.
Unqueued or never-attempted work older than 34 days is also manual. The route requires `CRON_SECRET` via
`Authorization: Bearer ...` or `x-cron-secret` and includes attempted/reported/failed billing counts
in its response. It returns an unhealthy response when an attempted-without-reported dimension or
expired unqueued result requires operator reconciliation.

Stripe meter-event API acceptance is asynchronous. A local `reported` timestamp means Stripe
accepted the API call, not that the event has settled onto an invoice. Configure a Workbench event
destination and alerting for `v1.billing.meter.error_report_triggered` and
`v1.billing.meter.no_meter_found`, then reconcile settled meter summaries and invoices. Never
blindly retry an ambiguous at-most-once claim.

## Invoice finalization and incident ownership

In both sandbox and live mode, set the Stripe **Invoice finalization grace period** to the maximum
72 hours for subscription-cycle invoices with a metered price. Stripe defaults this setting to one
hour; Habla requires the longer window so a recoverable local delay can settle before the invoice
is finalized. Configure and verify the rule separately in each mode on Stripe's
[Invoice settings page](https://docs.stripe.com/billing/subscriptions/usage-based/configure-grace-period).
The first subscription invoice can still finalize immediately. The 72-hour invoice delay does not
expand the separate 34-day first-delivery acceptance window and never makes an attempted ambiguous
claim safe to replay.

The billing operator owns every reconciliation alert until there is written evidence of resolution.
For pending or ambiguous usage, compare the scoped v3 row, Stripe meter-event/meter-summary state,
and affected draft or finalized invoice; then either mark a confirmed accepted event reported or
apply a reviewed correction. Never clear or retry an ambiguous row based only on its age.

Live operations must also alert a named operator through a Stripe Workbench Event Destination for
[`invoice.finalization_failed`](https://docs.stripe.com/billing/subscriptions/webhooks#invoice-finalization-failure).
The application does not ingest that invoice event. On alert, the owner must inspect the invoice's
`last_finalization_error` (and `automatic_tax.status` when relevant), stop new Checkout, and compare
the customer, subscription, local access projection, scoped usage rows, meter summaries, and
invoice. A subscription can remain active while its invoice cannot be finalized or collected, so
the owner must explicitly suspend the affected teacher with `AI_TEACHER_DENYLIST` (or disable AI
globally) unless a documented exception is approved. Restore access only after the invoice is
successfully finalized or otherwise resolved, collection status and any correction are decided,
and the Stripe invoice is reconciled to the local ledger.

## Test-mode launch checklist

Do not enable live billing until every item passes in one Stripe test/sandbox account:

1. Leave both `STRIPE_USAGE_BILLING_ENABLED=false` and `STRIPE_CHECKOUT_ENABLED=false`. Set the
   sandbox's `STRIPE_TEST_SECRET_KEY` and exact `STRIPE_ACCOUNT_ID`; verify the key's account in the
   Dashboard before any apply command.
2. Run `npm run stripe:catalog:plan`, then `npm run stripe:catalog:test:apply`, then the plan again.
   Copy the printed test Price IDs into `STRIPE_AI_GRADE_PRICE_ID` and
   `STRIPE_AI_AUDIO_SECONDS_PRICE_ID` without reordering them.
3. Run `npm run stripe:payment-methods:plan`,
   `npm run stripe:payment-methods:test:apply`, and its plan again. Require an unchanged exact
   active card-only configuration. Copy its `pmc_...` ID into
   `STRIPE_PAYMENT_METHOD_CONFIGURATION_ID` and
   `STRIPE_TEST_PAYMENT_METHOD_CONFIGURATION_ID`.
4. Run `npm run stripe:portal:plan`, `npm run stripe:portal:test:apply`, and its plan again. Portal
   setup must verify the account and card-only `pmc_...` before writing. Copy the reused Portal v3
   `bpc_...` ID into `STRIPE_PORTAL_CONFIGURATION_ID`. Require the exact configuration name,
   canonical billing return URL, business-profile headline, privacy URL, and terms URL in the final
   unchanged plan.
5. Set `STRIPE_SECRET_KEY` to the matching test secret or restricted key. Configure the Checkout
   Terms URL, verify the Portal login link remains enabled, enable the Checkout and Payment Links
   one-subscription limit with the Portal redirect, and set the metered subscription-cycle
   invoice-finalization rule to 72 hours. Start the four-event Stripe CLI listener and set its
   `whsec_...` as `STRIPE_WEBHOOK_SECRET`. Require the listener's account default or loaded webhook
   configuration to use the exact runtime API version. Inspect a delivered Event and require its
   `api_version` to equal `2026-07-29.dahlia` (the exact `STRIPE_API_VERSION`); capture both the
   listener/endpoint configuration and delivered-event payload-version evidence.
6. Run the focused offline suite:

   ```bash
   npm test -- __tests__/stripe-catalog.test.ts __tests__/stripe-catalog-validation.test.ts __tests__/stripe-portal-validation.test.ts __tests__/stripe-live-setup.test.ts __tests__/stripe-runtime.test.ts __tests__/stripe-persistence.test.ts __tests__/stripe-metering.test.ts __tests__/stripe-transaction-ordering.test.ts __tests__/billing-routes.test.ts
   ```

7. Run `npm run stripe:catalog:verify` and require a clean result. Set
   `NEXTAUTH_URL=http://localhost:3000`, prove a complete AI grading request works, then start the
   app. Set `STRIPE_USAGE_BILLING_ENABLED=true`, then `STRIPE_CHECKOUT_ENABLED=true` last, sign in
   as a test teacher, and open
   `/billing`. Status must say Stripe test mode and Checkout must use Stripe's hosted test flow.
   Confirm the unversioned and v2 legacy billing tables are empty and all accounts, billing markers,
   and v3 usage rows have account/contract scope; any exception is a blocker, not migration input.
8. Complete Checkout with a Stripe test card. Confirm the CLI forwards a successful
   `checkout.session.completed`, the exact two-Price subscription is projected `active`, and
   `/api/billing/status` reflects it. Prove a `trialing` subscription does not grant access. Open
   the Customer Portal, replace the test card, update an allowed customer field, and return.
9. Produce a new valid AI grade. Verify one local v3 ledger row, the expected non-credited meter
   events, and matching status totals. Retry the exact same recording for the same teacher and
   assignment and prove it adds no second charge. Then submit different recording bytes that yield
   the same transcript/text-grade cache result and prove they receive a distinct delivery identity
   and charge. Exercise deterministic, provider retry, failed, and unable-to-grade paths; none may
   add an extra logical charge.
10. Verify a teacher receives exactly `max(0, min(qualifying classes, 30) - 1)` whole-result credits
    in the UTC month—at most 29—and that credited rows produce no Stripe meter events. Include a
    greater-than-30-class case proving the stored high-water mark and allowance remain capped.
11. Interrupt one test meter delivery after its local claim. Call the authorized cleanup route and
    verify that ambiguous dimension is not sent again. Reconcile it in Stripe before applying any
    manual correction. Also simulate a process stop after attempt persistence but before usage-row
    creation; the next daily cleanup must reconstruct exactly one semantic usage row when its
    original result is within 34 days. Prove a never-attempted older row and every attempted row are
    classified for manual reconciliation rather than automatic replay.
12. Exercise `trialing`, `past_due`, `unpaid`, `incomplete`, cancellation, account/contract drift,
    and payment-method recovery. Verify
    that the Portal remains available when Checkout is disabled and that signed cancellation
    still revokes local access when usage billing is disabled.
13. In Stripe test mode, create a subscription-cycle invoice with a Test Clock and verify its
    scheduled finalization reflects the configured 72-hour grace period (the initial subscription
    invoice can finalize immediately). Reconcile pending local usage and Stripe meter summaries
    before finalization, then finalize or advance the clock. Reconcile every quantity and amount
    against the scoped test-mode v3 ledger and the two published rates, including zero Stripe usage
    for credited results. Record the rule and reconciliation evidence before live activation.
14. Send a test `invoice.finalization_failed` event through the intended operational Event
    Destination and prove the named billing operator receives it and can execute the incident
    procedure above. This is an operations drill; the Habla webhook does not ingest invoice events.

## Test-to-live data boundary

Prefer an isolated sandbox database and a dedicated sandbox teacher whose Stripe Customer,
subscription, grading-attempt snapshots, credit periods, and usage rows never enter the production
database. A sandbox Stripe account alone is not sufficient isolation if it writes test-mode billing
state into the production database.

If a shared database was used, keep AI usage and Checkout disabled, make a restorable backup, and
inventory every test-mode `stripe_billing_accounts` row plus every test-mode
`ai_billing_credit_periods_v3` and `ai_billing_usage_v3` row. Also inventory the quarantined
unversioned and v2 tables. Reconcile those rows and any matching
billable-attempt snapshot to the sandbox meter summaries and invoices, record the evidence, then
clear the test-only account and v3 state through an explicitly reviewed operation before live
activation. Recheck that every legacy table is empty and every remaining row has its immutable
account/contract scope. Never relabel a test row by changing `livemode`, account/contract,
Customer/subscription IDs, price-book ID, or catalog fingerprint. Live state must begin with a fresh
live Customer/Checkout/webhook projection and new live-scoped ledger rows.

## Live activation checklist

The ordinary setup commands remain test/sandbox-only. Live catalog, Payment Method Configuration,
and Portal provisioning use the separate `stripe:live:setup` command. That command is read-only by
default and remains inert unless every production/live gate and both exact identity confirmations
are present. Applying additionally requires both explicit mutation flags. Never reuse test resource IDs
in production, and never use the temporary setup credential as the production runtime credential.

Complete every item in order:

1. Finish the complete test-mode checklist above, reconcile a finalized test invoice to the scoped
   test ledger, and complete the test-to-live data-boundary procedure above.
2. In the Stripe Dashboard's **live** mode, confirm again that v1 has no subscriptions, invoice
   items, meter events, or usage. The application database check is already complete; this Stripe
   check remains mandatory.
3. Create a temporary local live setup secret or restricted key with only the permissions required
   to retrieve the account and manage Products, Prices, Billing Meters, Payment Method
   Configurations, and Customer Portal configurations. Do not place this credential in Vercel or a
   checked-in file. Keep both feature flags and Automatic Tax disabled, and arm only the approved
   local setup window:

   ```dotenv
   NODE_ENV=production
   STRIPE_ALLOW_LIVE=true
   STRIPE_LIVE_SETUP_APPROVED=true
   STRIPE_LIVE_SETUP_SECRET_KEY=sk_live_...
   STRIPE_ACCOUNT_ID=acct_...
   STRIPE_USAGE_BILLING_ENABLED=false
   STRIPE_CHECKOUT_ENABLED=false
   STRIPE_AUTOMATIC_TAX_ENABLED=false
   ```

4. After explicit live-read approval, run the default read-only plan with the exact configured
   account and immutable price-book confirmations:

   ```bash
   npm run stripe:live:setup -- --allow-live-read-only --confirm-account acct_... --confirm-price-book habla-teacher-ai-usd-v2
   ```

   The tool validates every local gate before network access and remotely verifies the account
   before listing any resource. Review the printed account, price book, catalog fingerprint, and
   catalog and Payment Method plan. It also plans the Portal when an exact `pmc_...` already exists;
   otherwise it explicitly defers that dependent plan. Save the output as launch evidence. Any
   foreign-mode resource, account mismatch, ambiguous immutable resource, or contract drift is a
   blocker.
5. After a separate live-mutation approval, apply the same reviewed plan by adding both mutation
   flags. Do not abbreviate either confirmation:

   ```bash
   npm run stripe:live:setup -- --allow-live-read-only --allow-live-apply --apply --confirm-account acct_... --confirm-price-book habla-teacher-ai-usd-v2
   ```

   The tool reconciles only the exact manifest's Products, Prices, Billing Meters, active card-only
   Payment Method Configuration, and Customer Portal. It does not create Customers, subscriptions,
   webhooks, tax configuration, or Dashboard operational settings. A partial apply is safe to
   inspect by rerunning the plan; do not create substitute resources by hand or change an immutable
   Price in place. The tool never mutates a Portal that was deferred in the pre-mutation plan. If it
   first created or repaired the `pmc_...`, return to step 4, review the now-actionable Portal plan,
   obtain a separate mutation approval, and rerun step 5.
6. Run the exact read-only command from step 4 again. Require every catalog item, the Payment Method
   Configuration, and the Portal to be `unchanged`. Capture the output and copy only its printed live
   `price_...`, `pmc_...`, and `bpc_...` IDs. In the Dashboard, independently verify both SUM meters,
   customer mapping through `stripe_customer_id`, integer payload key `value`, exact v2 Products and
   Prices, and that no feedback-token Price exists. Verify the Payment Method Configuration has card
   effectively `on` and every surfaced non-card method `off`. Verify Portal v3 pins that `pmc_...`,
   its exact name, `https://tryhabla.com/billing` default return URL, Habla headline,
   `https://tryhabla.com/privacy`, `https://tryhabla.com/terms`, exact metadata, hosted login, allowed
   customer fields, invoice history, card recovery, cancellation at period end without proration,
   and disabled subscription updates. Then revoke the temporary setup key, remove it from the local
   environment, and reset `STRIPE_LIVE_SETUP_APPROVED=false`.
7. Verify the Portal login link is enabled. In live Checkout and Payment Links settings, enable the
   one-subscription limit and redirect existing subscribers to the pinned Portal; capture Dashboard
   evidence for both settings.
8. In live Invoice settings, create or verify the 72-hour finalization-grace rule for
   subscription-cycle invoices with a metered Price. Configure the Terms URL, support email,
   revenue-recovery notifications, meter-error Event Destination, and a separate operational
   Event Destination/alert for `invoice.finalization_failed` with a named billing owner. Configure
   a live webhook endpoint, explicitly configured with payload API version
   `2026-07-29.dahlia`, at
   `https://<production-origin>/api/billing/webhook` for
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, and `customer.subscription.deleted`. Save that endpoint's own
   live `whsec_...` secret. Inspect a delivered live Event and require its `api_version` to equal
   `2026-07-29.dahlia` (the exact runtime `STRIPE_API_VERSION`). Capture endpoint configuration and
   delivered-event payload-version evidence; a version mismatch is a blocker.
9. Record the tax-registration decision and keep `STRIPE_AUTOMATIC_TAX_ENABLED=false`. This release
   rejects Automatic Tax and also rejects manual subscription/item tax rates. Any future tax
   collection requires a reviewed Product tax code, Price tax behavior, account registrations,
   Checkout/Portal behavior, and a new immutable billing-contract/code revision before activation.
10. With both feature flags still false, set `NODE_ENV=production`, `STRIPE_ALLOW_LIVE=true`, and a
   separately scoped production runtime `STRIPE_SECRET_KEY`, plus `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_ACCOUNT_ID`, `STRIPE_PAYMENT_METHOD_CONFIGURATION_ID`,
   `STRIPE_PORTAL_CONFIGURATION_ID`,
   `STRIPE_AI_GRADE_PRICE_ID`, and `STRIPE_AI_AUDIO_SECONDS_PRICE_ID` from the same live Stripe
   account. Do not set `STRIPE_LIVE_SETUP_SECRET_KEY` or `STRIPE_LIVE_SETUP_APPROVED=true` in the
   deployment, and never expose a live key to Preview. Run
   `npm run stripe:catalog:verify -- --allow-live-read-only` and require the exact v2 fingerprint
   before deployment. Keep `STRIPE_USAGE_BILLING_ENABLED=false` and
   `STRIPE_CHECKOUT_ENABLED=false` throughout this read-only verification. Before rolling out the
   grading-attempt delivery lifecycle migration, set `AI_GRADING_ENABLED=false` on the currently
   serving production deployment and wait for every old instance and in-flight grade to drain.
11. Keep both enable flags false while deploying and checking `/api/billing/status`. Verify the
   billing storage health is ready, every unversioned/v2 legacy table is empty, every v3 row is
   scoped, no test-mode account or v3 ledger state remains in the production cutover scope, the
   `delivery_status` migration is complete, and every serving instance uses the new atomic-delivery
   writer. Keep AI off until those checks pass. Then enable `STRIPE_USAGE_BILLING_ENABLED=true`,
   enable `AI_GRADING_ENABLED=true` with `AI_ACCESS_MODE=paid`, and enable
   `STRIPE_CHECKOUT_ENABLED=true` last only after approval.
12. Run one controlled live Checkout and one minimal successful AI grade. Confirm the signed
    webhook, subscription projection, two meter events where applicable, Portal return, and invoice
    preview. Verify that the renewal invoice is scheduled with the 72-hour rule, then reconcile
    Stripe quantities and amounts to the live-scoped v3 ledger before widening access.
13. If any identity, amount, mode, webhook, finalization-alert, or reconciliation check fails, set
    `STRIPE_CHECKOUT_ENABLED=false` immediately to stop acquisition. If usage must also stop, disable
    AI first, then set `STRIPE_USAGE_BILLING_ENABLED=false`; keep the Stripe client credential,
    webhook, and pinned Portal configuration operational so customers can cancel and non-entitled
    states still project.
    Do not repair an immutable Price in place; correct the setup under a new reviewed price-book.

## Live-mode guard

The runtime rejects an `sk_live_...` or `rk_live_...` key unless both conditions are true:

```dotenv
NODE_ENV=production
STRIPE_ALLOW_LIVE=true
```

That is only a technical guard, not a go-live recommendation. Keep `STRIPE_ALLOW_LIVE=false` until
live-read approval and the relevant checklist prerequisites have passed. Turning it on permits only
code paths with their own guards; it does not authorize billing, and both feature flags must remain
false through provisioning and runtime verification. The setup-only credential and
`STRIPE_LIVE_SETUP_APPROVED=true` are temporary, local gates and must be removed/reset immediately
after the verified post-apply plan. Do not enable live billing until both checklists pass, Stripe
Dashboard confirms v1 had no live state, and a finalized test invoice has been reconciled to the
local ledger. Tax configuration, webhook registration, operational alerting, live mutation, and
rollback approval remain separate production decisions.
