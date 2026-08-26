# Stripe Teacher subscription billing

TryHabla uses one fixed licensed subscription for the public Teacher plan. The canonical commercial
contract is `TEACHER_AI_PRICE_BOOK` in `lib/teacher-ai-pricing.ts`; Stripe catalog code imports that
same object so entitlement, quota, UI, and Stripe cannot silently use different price-book IDs.

## Launch contract

| Field | Required value |
| --- | --- |
| Price book | `tryhabla-teacher-usd-v3` |
| Customer-facing Product name | `TryHabla` |
| Internal Product ID | `tryhabla_teacher_usd_v3` |
| Price lookup key | `tryhabla_teacher_usd_v3_monthly` |
| Runtime Price variable | `STRIPE_TRYHABLA_TEACHER_PRICE_ID` |
| Currency and amount | USD $20.00 |
| Recurrence | Monthly, interval count 1 |
| Usage type | `licensed` |
| Checkout quantity | 1 |
| Included allowance | 300 AI-assisted recordings per Stripe billing period |
| Allowance unit | One successfully delivered transcript; optional grading for that same recording and assignment is included |
| Recording limit | Up to 5 minutes per AI-assisted recording |
| At the limit | Pause AI only; core recording, playback, downloads, and manual grading remain available |
| Overage and rollover | None |

The Free plan's 30 lifetime AI-assisted recordings are app-side. Free has no Stripe Product, Price,
subscription, or meter. Provider failures, empty or unusable transcripts, and exact duplicates
consume no unit. A successfully delivered transcript consumes one unit; optional grading for that
same recording and assignment consumes no additional unit. The application must reserve allowance
atomically before provider work and finalize it only when a transcript is durably delivered.

There are no Stripe Billing Meters, meter events, usage records, per-grade invoice items, or audio
line items in v3. Provider cost telemetry may remain internal, but it is not customer billing.

## v2 migration boundary

The retired v2 contract used two metered Prices. Do not reuse, edit, or attach those Prices to a v3
subscription. Stripe Prices are immutable, and the v3 catalog has a new ID and fingerprint.

The runtime rejects these retired settings:

```dotenv
STRIPE_USAGE_BILLING_ENABLED=true
STRIPE_AI_GRADE_PRICE_ID=price_...
STRIPE_AI_AUDIO_SECONDS_PRICE_ID=price_...
```

Remove the retired variables before enabling v3. Old test Products, Prices, and Meters may remain
archived in the sandbox, but they are not migration input. Before live activation, independently
verify that no live v2 subscription or unresolved v2 invoice/usage state exists. If any exists,
stop and implement a reviewed subscription migration instead of repointing the runtime.

## Legacy manual-access boundary

Older releases used `users.is_paid` both for founder-issued access and as a side effect of teacher
or admin allowlisting. The v3 migration therefore labels every origin-less legacy paid bit (and
repairs any early guessed provenance) as `legacy_unclassified` and grants it no AI allowance. Do
not infer provenance from the current allowlist. Before production activation, review those rows
with the operator and explicitly regrant
only real manual-grant accounts through the admin teacher roster. New allowlisted sign-ins receive
the teacher role only; new admin toggles persist explicit manual-grant provenance.

## Provision the sandbox catalog

Keep acquisition and subscription entitlement disabled during setup:

```dotenv
STRIPE_SUBSCRIPTION_BILLING_ENABLED=false
STRIPE_CHECKOUT_ENABLED=false
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_ACCOUNT_ID=acct_...
```

`STRIPE_TEST_SECRET_KEY` is tooling-only. Ordinary setup commands reject live keys and remotely
verify the exact configured `acct_...` before listing or changing resources.

Plan first; this is read-only:

```bash
npm run stripe:catalog:plan
```

After reviewing the exact plan, apply only to the sandbox:

```bash
npm run stripe:catalog:test:apply
npm run stripe:catalog:plan
```

The final plan must show one Product and one Price as `unchanged`. Copy the printed Price ID:

```dotenv
STRIPE_TRYHABLA_TEACHER_PRICE_ID=price_...
```

The setup command may repair mutable Product presentation fields only when immutable identity
metadata still matches. Any Price amount, currency, lookup key, recurrence, Product, usage type,
tax behavior, mode, or fingerprint drift fails closed and requires a new price-book version.

## Configure runtime, Checkout, and Portal

Use values from one Stripe mode and one exact account:

```dotenv
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_ACCOUNT_ID=acct_...
STRIPE_TRYHABLA_TEACHER_PRICE_ID=price_...
STRIPE_PAYMENT_METHOD_CONFIGURATION_ID=pmc_...
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
STRIPE_AUTOMATIC_TAX_ENABLED=false
STRIPE_ALLOW_LIVE=false
STRIPE_SUBSCRIPTION_BILLING_ENABLED=false
STRIPE_CHECKOUT_ENABLED=false
```

The immutable billing-contract ID includes the Stripe account, API version, key mode, v3 price book,
catalog fingerprint, exact Teacher Price ID, tax setting, and card-only payment policy. A mismatch
cannot silently grant access.

Checkout creates exactly one line item:

```text
TryHabla — $20.00 / month — quantity 1
```

It charges the fixed subscription price up front. It must not show separate grade/audio rows or a
zero-dollar usage invoice. Checkout remains gated behind the valid catalog, signed webhook config,
AI launch prerequisites, card-only payment configuration, and `STRIPE_CHECKOUT_ENABLED=true`.

The webhook must continue receiving:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `refund.created`

The final three events feed the private, durable Habla Pulse revenue/incident
outbox after signature verification. They do not change customer entitlement,
and Discord delivery is never performed in the webhook request path.

Only the exact supported subscription—correct account, mode, contract, catalog fingerprint, one
Teacher Price, licensed quantity 1, accepted collection state—may grant entitlement. Duplicate and
out-of-order events must converge safely; revocation and collection-problem states fail closed.

Customer Portal remains independently available to mapped customers when new Checkout is paused.
The pinned Portal contract keeps invoice history, card recovery, allowed customer updates, and
cancellation at period end without proration. Do not use the webhook secret as a routine kill switch
after subscriptions exist.

Enable subscription entitlement first and Checkout last:

```dotenv
STRIPE_SUBSCRIPTION_BILLING_ENABLED=true
STRIPE_CHECKOUT_ENABLED=true
```

The retired usage runtime remains disabled even when the licensed subscription runtime is enabled.
No `CRON_SECRET`, meter-event replay window, invoice grace period, or usage reconciliation is needed
for customer billing under this fixed Price.

## Sandbox acceptance checklist

Do not enable live billing until all items pass in one isolated sandbox:

1. Confirm both billing flags are false and old meter variables are absent.
2. Plan, apply, and re-plan the catalog; require one exact unchanged Product and Price.
3. Run the read-only runtime verifier and require the exact account, v3 fingerprint, and test mode.
4. Verify the card-only Payment Method Configuration and pinned Customer Portal configuration.
5. Configure a sandbox webhook with the exact pinned API version and its own `whsec_...`.
6. Run the focused billing tests, typecheck, and build.
7. Enable subscription billing, then Checkout. Complete one hosted test Checkout.
8. Confirm Checkout shows one `TryHabla` line at $20/month and charges the sandbox card $20.
9. Confirm the signed lifecycle projects one active subscription and Portal opens correctly.
10. Confirm the local allowance starts at 0/300 for the subscription's actual Stripe period.
11. Prove one successful unique result consumes one review; exact retries, failures, and
    unable-to-grade results consume none.
12. Prove concurrent attempts cannot exceed 300 and the 301st request pauses AI before provider
    work while core recording/manual grading remain available.
13. Verify period renewal resets the paid allowance to the new Stripe period without carrying
    unused reviews forward.
14. Exercise cancellation at period end, immediate deletion/revocation events, `past_due`,
    `unpaid`, `incomplete`, wrong Price, wrong quantity, wrong mode, and account/fingerprint drift.
15. Confirm no Stripe meter events, usage records, or separate audio/grade invoice items exist.

Use an isolated sandbox database and teacher. Never relabel sandbox account, subscription, or quota
rows as live data.

## Live setup and activation

The live setup command is read-only unless every guard and explicit mutation flag is present. Keep
runtime billing disabled while planning or provisioning:

```dotenv
NODE_ENV=production
STRIPE_ALLOW_LIVE=true
STRIPE_LIVE_SETUP_APPROVED=true
STRIPE_LIVE_SETUP_SECRET_KEY=sk_live_...
STRIPE_ACCOUNT_ID=acct_...
STRIPE_SUBSCRIPTION_BILLING_ENABLED=false
STRIPE_CHECKOUT_ENABLED=false
STRIPE_AUTOMATIC_TAX_ENABLED=false
```

Read-only plan:

```bash
npm run stripe:live:setup -- --allow-live-read-only --confirm-account acct_... --confirm-price-book tryhabla-teacher-usd-v3
```

After separate live-mutation approval, apply the reviewed plan with both mutation flags:

```bash
npm run stripe:live:setup -- --allow-live-read-only --allow-live-apply --apply --confirm-account acct_... --confirm-price-book tryhabla-teacher-usd-v3
```

Re-run the read-only plan and require every item to be unchanged. Independently verify Product name
`TryHabla`, $20 USD licensed monthly Price, lookup key, quantity policy, Portal behavior, account,
mode, and webhook API version. Revoke the temporary setup credential and reset
`STRIPE_LIVE_SETUP_APPROVED=false`.

Deploy with the runtime credential and exact live IDs while both billing flags remain false. Run
the read-only runtime verifier, verify production storage/DB migrations and the allowance state,
then enable subscription entitlement. Enable AI only after its privacy/provider gates pass, and
enable Checkout last. Complete one controlled live Checkout and minimal successful review before
promotion.

If validation or lifecycle behavior fails, disable new Checkout immediately. Keep signed webhooks,
the runtime Stripe credential, and Portal operational so existing customers can recover payment or
cancel. Never repair an immutable Price in place and never print or commit Stripe secrets.
