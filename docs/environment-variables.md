# Environment Variables

This inventory reflects repository behavior. It does not verify production Vercel settings.

## Core Application

| Name | Purpose | Required | Scope | Absent behavior |
| --- | --- | --- | --- | --- |
| `NEXTAUTH_URL` | Canonical origin for auth redirects and CORS. | Production requires this or `VERCEL_PROJECT_PRODUCTION_URL`. | Server | Production startup/API validation fails if no origin can be derived. |
| `VERCEL_PROJECT_PRODUCTION_URL` | Vercel fallback production hostname. | Optional | Server | Used only when `NEXTAUTH_URL` is unset. |
| `LOCAL_DEV_BYPASS_AUTH` | Local-only auth bypass. | Optional | Server | Defaults disabled. Ignored in production. |

## Authentication

| Name | Purpose | Required | Scope | Absent behavior |
| --- | --- | --- | --- | --- |
| `AUTH_GOOGLE_ID` | Google OAuth client ID. | Yes | Server | Auth/API env validation fails. |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret. | Yes | Server | Auth/API env validation fails. |
| `AUTH_SECRET` | NextAuth signing secret. | Yes | Server | Auth/API env validation fails. |
| `AUTH_MICROSOFT_ID` | Enables optional Microsoft 365 sign-in when paired with `AUTH_MICROSOFT_SECRET`. | Optional | Server | Microsoft provider is not registered. |
| `AUTH_MICROSOFT_SECRET` | Microsoft OAuth secret. Must be paired with `AUTH_MICROSOFT_ID`. | Optional | Server | A partial pair is rejected and Microsoft remains disabled. |
| `AUTH_MICROSOFT_TENANT_ID` | Microsoft tenant. Use `organizations` for work/school accounts, `common` for work/school plus personal accounts, or a specific school tenant ID. | Optional | Server | Uses `common`. |

## Database

| Name | Purpose | Required | Scope | Absent behavior |
| --- | --- | --- | --- | --- |
| `TURSO_DATABASE_URL` | Turso/libSQL remote database URL. | Required in production with token. | Server | Local dev falls back to `data/local.db` when both Turso vars are absent. |
| `TURSO_AUTH_TOKEN` | Turso auth token. | Required in production with URL. | Server | App throws if only one Turso var is set. |

## Blob Storage

| Name | Purpose | Required | Scope | Absent behavior |
| --- | --- | --- | --- | --- |
| `AUDIO_BLOB_STORE_ID` | Identifies the private Vercel Blob store used for student recordings and assignment attachments. Deployed Vercel functions authenticate with project OIDC. | Required for private-media runtime operations in production and for migration dry run/apply. | Server and local/off-Vercel migration tooling | Upload/playback/delete operations fail safely; the migration refuses to start. |
| `AUDIO_READ_WRITE_TOKEN` | Static credential for the private store used by the one-time migration from a secured local/off-Vercel process. | Required for migration dry run and apply outside Vercel. Do not keep it in Vercel. | Local/off-Vercel migration tooling | The migration refuses to start because it cannot byte-validate private database references. |
| `BLOB_READ_WRITE_TOKEN` | Static credential for inventorying and deleting objects in the legacy public Blob store. It is not used for normal private-media runtime access. | Required only for the migration dry run and apply. Remove/revoke it after verified cleanup. | Local/off-Vercel migration tooling | The migration refuses to start; normal private-media runtime is unaffected. |
| `MEDIA_MIGRATION_DIAGNOSTIC_KEY` | Temporary random key, at least 32 bytes, used only to create stable opaque HMAC identifiers in a migration diagnostic report. Never print or commit it. | Required only with the dry-run-only `--diagnostics` option. Remove it after the investigation. | Local/off-Vercel migration tooling only | Ordinary dry run/apply is unaffected; diagnostic mode refuses to start. |

Student audio and assignment attachments must use private/access-controlled Blob storage. Public
fallback is disabled for new media. Keep both static migration tokens out of Vercel; production
runtime needs only the linked private store and `AUDIO_BLOB_STORE_ID`.

The migration is dry-run by default:

```bash
node scripts/migrate-public-audio-to-private.mjs
```

If the aggregate dry run reports legacy-source validation failures, rerun it from the same secured
operator environment with `--diagnostics` and a temporary `MEDIA_MIGRATION_DIAGNOSTIC_KEY`. The
diagnostic report includes only keyed reference IDs, media class, database-reference counts,
legacy-list membership, and safe request/HTTP/body-read phases for those legacy sources. Existing
private-reference failures remain represented by the separate private-validation counters. The
report never includes raw database IDs, object paths, URLs, media, student details, or provider
error messages. Reuse the same key only while correlating reruns, then remove it.

The dry run requires both private-store variables above as well as the Turso and legacy-store
credentials. Apply mode requires
`--apply --backup-confirmed --legacy-media-backup-confirmed`. The first confirmation asserts a
current, restorable production database backup. The second separately asserts a recoverable
backup/export of the legacy `submissions/` and `assignment-attachments/` prefixes, because a
database backup cannot recover unreferenced Blob objects removed by the final sweep. The flags do
not create or test either backup. Obtain explicit release-owner signoff, follow the ordered
release/migration procedure in `README.md`, repeat the dry run after apply, and treat any failed
private reference, remaining legacy reference, pending cleanup, or in-scope public object as a
blocker.

## Redis And Rate Limiting

| Name | Purpose | Required | Scope | Absent behavior |
| --- | --- | --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL. | Required for production rate limits. | Server | Dev skips rate limiting; production rate-limited routes return 503 if missing. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token. | Required with URL. | Server | Same as above. |
| `SUBMISSION_RATE_LIMIT_PER_HOUR` | Submission limit override. | Optional | Server | Defaults to code constant. |
| `AUTH_RATE_LIMIT_PER_HOUR` | Auth/feedback limit override. | Optional | Server | Defaults to code constant. |
| `GRADEBOOK_RATE_LIMIT_PER_HOUR` | Gradebook export limit override. | Optional | Server | Defaults to code constant. |

## Admin, Email, And Webhooks

| Name | Purpose | Required | Scope | Absent behavior |
| --- | --- | --- | --- | --- |
| `ADMIN_EMAILS` | Comma-separated emails allowed to view `/admin`; also grants the teacher role, but no AI allowance, on sign-in. | Optional | Server | Falls back to the legacy `ADMIN_EMAIL`. |
| `ADMIN_EMAIL` | Legacy single-admin setting, merged with `ADMIN_EMAILS`. | Optional | Server | Admin page/API deny access when both admin settings are empty. |
| `RESEND_API_KEY` | Teacher confirmation and feedback notification email. | Optional | Server | Email sends are skipped. |
| `DISCORD_ADMIN_ALERTS_ENABLED` | Delivery-only kill switch for the private durable admin-alert outbox. Only exact `true` enables network delivery; enqueue and deduplication continue while disabled. | Optional | Server | Defaults disabled; queued intents remain pending. |
| `DISCORD_ALERTS_ENV` | Explicit alert environment: `production`, `preview`, `development`, or `test`. Deployed values must agree with Vercel's environment. | Required before enabling delivery | Server | The runtime infers the platform environment; a configured mismatch fails delivery closed. |
| `DISCORD_ALERTS_REFERENCE_SECRET` | HMAC secret used to derive short irreversible teacher, lead, and payment references. Use at least 32 random characters. | Optional when `AUTH_SECRET` is present | Server | Falls back to `AUTH_SECRET`; identity derivation fails safely if neither is suitable. |
| `DISCORD_TRACTION_WEBHOOK_URL` | Private production traction destination. | Required when production delivery is enabled | Server secret | That destination retries and eventually dead-letters without affecting customer workflows. |
| `DISCORD_REVENUE_WEBHOOK_URL` | Private production revenue destination. | Required when production delivery is enabled | Server secret | Same as above. |
| `DISCORD_MILESTONES_WEBHOOK_URL` | Private production milestone destination. | Required when production delivery is enabled | Server secret | Same as above. |
| `DISCORD_PULSE_WEBHOOK_URL` | Private production daily/weekly pulse destination. | Required when production delivery is enabled | Server secret | Same as above. |
| `DISCORD_INCIDENTS_WEBHOOK_URL` | Private production incident destination. | Required when production delivery is enabled | Server secret | Same as above. |
| `DISCORD_TEST_WEBHOOK_URL` | Sole destination permitted for Preview, Development, and Test alerts. | Required when non-production delivery is enabled | Server secret | Non-production delivery fails closed; it can never fall through to production hooks. |
| `DISCORD_AI_P95_TARGET_MS` | Rolling 24-hour p95 AI grading-latency incident threshold in milliseconds; accepted range is 1000-600000. | Optional | Server | Defaults to 60000 ms. Alerts require at least 20 terminal latency samples. |
| `DISCORD_WEBHOOK_URL` | Removed legacy request-path webhook. | No | Server | Ignored. Remove it from deployments after rollout. |

## Cron

| Name | Purpose | Required | Scope | Absent behavior |
| --- | --- | --- | --- | --- |
| `CRON_SECRET` | Authorizes cleanup and admin-alert cron routes. It is not part of licensed Stripe subscription or Checkout readiness. | Required when either cron route is invoked. | Server | Cron routes deny requests; subscription billing and Checkout are unaffected. |

## School And Role Controls

| Name | Purpose | Required | Scope | Absent behavior |
| --- | --- | --- | --- | --- |
| `TEACHER_ALLOWLIST` | Comma-separated emails promoted by default and allowed to self-register in production. This grants the teacher role only, never AI allowance. | Optional | Server | No allowlisted teachers. |
| `ALLOW_TEACHER_SELF_REGISTRATION` | Opens production teacher self-registration when `true`. | Optional | Server | Production self-registration is closed except allowlist/existing teachers. |
| `ENFORCE_STUDENT_DOMAIN` | Restricts submissions to configured domain. | Optional | Server | Domain restriction disabled. |
| `STUDENT_DOMAIN` | Required student email domain when enforcement is on. | Optional | Server | Falls back to teacher email domain when enforcement is on. |
| `REQUIRE_ROSTER_FOR_SUBMISSIONS` | Requires student email to be on class roster before submitting. | Optional | Server | Public assignment-link workflow remains available to signed-in students. |

## Experimental AI

| Name | Purpose | Required | Scope | Absent behavior |
| --- | --- | --- | --- | --- |
| `AI_GRADING_ENABLED` | Enables prototype AI grading route/UI when `true`. | Optional | Server | Defaults disabled; API returns unavailable before audio/model calls. |
| `AI_BULK_GRADING_ENABLED` | Enables synchronous grade-all separately from single grading. | Optional | Server | Defaults disabled; keep off until bulk work runs as a durable resumable job. |
| `AI_TRANSCRIPTION_PROVIDER` | Selects `openai` or local `mock`. | Required for a reviewed launch | Server | Defaults to `openai`. |
| `AI_GRADING_PROVIDER` | Selects `openai`, `ollama`, or local `mock`. | Required for a reviewed launch | Server | Defaults to `openai` in production and local `ollama` otherwise; set it explicitly for deployments. |
| `AI_TRANSCRIPTION_MODEL` | Exact transcription model ID. The repository candidate is `gpt-4o-mini-transcribe`, but it is not approved merely by appearing here. | Optional, but set explicitly for production AI | Server | Production defaults to `gpt-4o-transcribe`. The runtime honors an explicit value without silently substituting a different cost/behavior profile. |
| `AI_GRADING_MODEL` | Legacy-compatible exact grading model setting used when `GRADING_DEFAULT_MODEL` is absent. | Optional, but set explicitly for production AI | Server | The provider-neutral setting takes precedence. The runtime does not silently replace explicit model IDs. |
| `AI_ACCESS_MODE` | `paid` grants the Free lifetime allowance and then AI through either an explicit manual entitlement or an exact remotely verified active Stripe subscription; `all` bypasses allowance limits for every authenticated teacher. | Optional | Server | Defaults to `paid`; production fails closed if `all` is combined with open teacher self-registration. |
| `AI_TEACHER_DENYLIST` | Comma-separated emergency account suspension list in either access mode. | Optional | Server | No accounts are denied. |
| `AI_STUDENT_DATA_APPROVED` | Versioned operator attestation after student-data, disclosure, retention, school authorization, provider controls, and exact-model review. The current accepted value is `reviewed-2026-08-25`; the old boolean `true` is intentionally rejected. | Required for production AI | Server | Production provider calls fail closed and `/api/features` hides AI. Re-attest when the policy, provider, model set, or retention behavior materially changes. |
| `AI_MONTHLY_BUDGET_USD` | App-side UTC-calendar-month reservation ceiling. | Required for production AI | Server | Defaults to `200`; zero fails configuration. |
| `AI_RESERVED_COST_USD_PER_GENERATION` | Conservative amount atomically reserved before each provider-backed generation. | Required for production AI | Server | Defaults to `0.04`; zero fails configuration. |
| `AI_MAX_AUDIO_SECONDS` | Maximum provider-graded recording duration. | Optional | Server | Defaults to 300 seconds. |
| `AI_MAX_GENERATIONS_PER_SUBMISSION` | Regeneration cap per submission. | Optional | Server | Defaults to 10. |
| `AI_GENERATION_COOLDOWN_SECONDS` | Delay between regenerations. | Optional | Server | Defaults to 3 seconds. |
| `AI_DAILY_TEACHER_LIMIT` | Rolling-24-hour per-teacher attempt cap. | Optional | Server | Defaults to 20. |
| `AI_DAILY_GLOBAL_LIMIT` | Rolling-24-hour app-wide attempt cap. | Optional | Server | Defaults to 500. |
| `AI_PROVIDER_TIMEOUT_MS` | Provider request timeout. | Optional | Server | Defaults to 120000 ms. |
| `AI_PROVIDER_MAX_RETRIES` | OpenAI SDK transient retry count. | Optional | Server | Defaults to 2. |
| `AI_GRADING_MAX_OUTPUT_TOKENS` | Maximum grading-model output. | Optional | Server | Defaults to 1200. |
| `GRADING_DEFAULT_PROVIDER` | Provider-neutral default grading provider. | Optional | Server | Falls back to `AI_GRADING_PROVIDER`; production defaults to OpenAI when neither is set. |
| `GRADING_DEFAULT_MODEL` | Exact provider-neutral default grading model; takes precedence over `AI_GRADING_MODEL`. | Optional, but set explicitly for production | Server | OpenAI defaults to `gpt-5.4-mini`; explicit values are not silently substituted. |
| `GRADING_ESCALATION_PROVIDER` | Provider used only when a result meets an escalation condition and the escalation-rate guard allows it. | Optional | Server | Defaults to the default provider for local/mock providers and OpenAI otherwise. |
| `GRADING_ESCALATION_MODEL` | Exact model used for permitted escalation requests. | Optional | Server | OpenAI defaults to `gpt-5.4`; explicit values are not silently substituted. |
| `GRADING_AUDIO_STRATEGY` | Selects `transcribe_then_grade`, `gemini_direct`, or `auto`. | Set explicitly for production AI | Server | Defaults to `auto`, which can select direct Google audio when configured. The repository candidate pins `transcribe_then_grade`. |
| `GRADING_AUDIO_MODEL` | Exact Google model for optional direct-audio grading. | Required only when that path is reviewed and enabled | Server | Defaults to `gemini-2.5-flash-lite`; unused by the pinned transcription-first candidate. |
| `GRADING_AUDIO_ESCALATION_MODEL` | Exact Google model for optional direct-audio escalation. | Required only when that path is reviewed and enabled | Server | Defaults to `gemini-2.5-flash`; unused by the pinned transcription-first candidate. |
| `GRADING_DAILY_TEACHER_LIMIT` | Daily per-teacher provider-request limit for the grading pipeline. | Optional | Server | Falls back to `AI_DAILY_TEACHER_LIMIT`, or 200 when neither is set. |
| `GRADING_MONTHLY_TEACHER_LIMIT` | Monthly per-teacher provider-request limit for the grading pipeline. | Optional | Server | Defaults to 3000. |
| `GRADING_PROVIDER_MAX_RETRIES` | Transport/provider retries for each grading-model call. | Optional | Server | Defaults to 0; accepted range is 0-2. |
| `GRADING_FORMAT_RETRIES` | One bounded retry for a schema/formatting failure. | Optional | Server | Defaults to 1 and is capped at 1. |
| `OPENAI_API_KEY` | Direct OpenAI transcription/grading project key. | Required when either provider is `openai` and AI Gateway is unavailable or disabled | Server | Set `AI_GATEWAY_ENABLED=false` to use this key directly on Vercel. |
| `AI_GATEWAY_ENABLED` | Chooses Vercel AI Gateway when Gateway credentials are available. | Optional | Server | Defaults enabled; set `false` to bypass Gateway and use `OPENAI_API_KEY` directly. |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway credential for non-Vercel runtimes. | Optional | Server | Deployed Vercel functions use the rotating `VERCEL_OIDC_TOKEN` automatically. |
| `GOOGLE_API_KEY` | Google Gemini credential for provider-neutral or direct-audio grading. | Required only when a Google path is explicitly reviewed and configured | Server | Google-backed grading fails closed. |
| `OPENROUTER_API_KEY` | OpenRouter credential for provider-neutral grading. | Required only when OpenRouter is explicitly reviewed and configured | Server | OpenRouter-backed grading fails closed. |
| `OLLAMA_URL` | Prototype grading model endpoint. | Optional/experimental | Server | Defaults to local URL in prototype code only when AI is enabled. |
| `OLLAMA_MODEL` | Prototype grading model name. | Optional/experimental | Server | Defaults to `llama3.2` in prototype code only when AI is enabled. |

For the release that introduces the grading-attempt `delivery_status` lifecycle, keep
`AI_GRADING_ENABLED=false` on the running production deployment before rollout and wait for all old
instances and in-flight grading requests to drain. Deploy and verify the migration while AI remains
off; enable AI only after every serving instance runs the new writer. This ordering prevents an old
instance from creating an attempt that the new delivery finalizer or cleanup path could strand.

The repository's low-cost candidate explicitly pins OpenAI providers,
`AI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe`, `GRADING_DEFAULT_MODEL=gpt-5-nano`,
`GRADING_ESCALATION_MODEL=gpt-5-mini`, and `GRADING_AUDIO_STRATEGY=transcribe_then_grade` (plus the
same legacy `AI_GRADING_MODEL` while that fallback remains). Treat the whole set as a candidate,
not approval: benchmark grading quality and cost, verify the adapters and provider controls, and
record the exact chosen IDs before setting the versioned student-data gate.

Provider-request limits and customer allowances are deliberately different. Transcription, grading,
a bounded formatting retry, or escalation can create multiple provider requests for one logical
result. The limits above bound that provider work. The Teacher plan consumes at most one app-side
review for one valid, unique, delivered teacher/assignment/recording identity. Exact retries,
internal provider retries, and failed or unable-to-grade results consume no additional review.

## Stripe Teacher subscription billing (price book v3)

The active Stripe price book is `tryhabla-teacher-usd-v3`: one customer-facing Product named
`TryHabla` and one licensed recurring USD Price at $20 per month, quantity 1. The application grants
300 successful AI reviews per Stripe billing period and pauses only AI at the limit; there are no
automatic overages or Stripe meter events. Keep all Stripe values server-only; never expose them
through a `NEXT_PUBLIC_*` name.

| Name | Purpose | Required | Scope | Absent behavior |
| --- | --- | --- | --- | --- |
| `STRIPE_SUBSCRIPTION_BILLING_ENABLED` | Enables Stripe-derived Teacher entitlement after the exact v3 catalog and webhook have been verified. | Optional | Server | Defaults disabled. Stripe subscriptions do not grant AI until enabled; signed webhook and Portal capabilities remain independently configured. |
| `STRIPE_CHECKOUT_ENABLED` | Enables creation of new Teacher Checkout Sessions. Turn this on last, only while subscription billing is also enabled. | Optional | Server | Defaults disabled. Existing signed webhooks and Customer Portal access remain available. |
| `STRIPE_BILLING_ENABLED` | Removed legacy all-in-one switch. | No | Server | `true` is rejected so an old deployment setting cannot accidentally open Checkout. Use the two explicit flags above. |
| `STRIPE_USAGE_BILLING_ENABLED` | Retired v2 meter-delivery switch. | No | Server | Any configured value is rejected when v3 subscription billing or Checkout is enabled. Remove this variable. |
| `STRIPE_AI_GRADE_PRICE_ID` | Retired v2 per-grade metered Price. | No | Server | Any configured value makes the v3 catalog invalid. Remove this variable. |
| `STRIPE_AI_AUDIO_SECONDS_PRICE_ID` | Retired v2 processed-audio metered Price. | No | Server | Any configured value makes the v3 catalog invalid. Remove this variable. |
| `STRIPE_TEST_SECRET_KEY` | Test/sandbox credential used only by the catalog, Payment Method Configuration, and Customer Portal setup commands. | Required only for `stripe:catalog:*`, `stripe:payment-methods:*`, and `stripe:portal:*` setup commands | Local/server tooling | Setup cannot run. Live keys are rejected, and the runtime does not read this variable. |
| `STRIPE_LIVE_SETUP_SECRET_KEY` | Temporary live secret or restricted key used only by the separately armed local live-provisioning tool. It must be able to retrieve the account and manage Products, Prices, Payment Method Configurations, and Customer Portal configurations. Billing Meter permission is not required. Never put it in Vercel or reuse it as a browser-visible value. | Required only for an explicitly approved `stripe:live:setup` plan/apply | Local operator tooling only | The live setup tool cannot read or mutate Stripe. The runtime does not read this variable. |
| `STRIPE_LIVE_SETUP_APPROVED` | Ephemeral operator approval gate for the live setup tool. The tool also requires production/live guards and exact command-line confirmations. | Required as `true` only during an approved live setup window | Local operator tooling only | Live setup refuses all remote reads and writes. Reset to `false` immediately after the verified post-apply plan. |
| `STRIPE_ACCOUNT_ID` | Exact Stripe platform account ID (`acct_...`) bound to this deployment and its immutable billing contract. Setup and runtime remotely verify the credential resolves to this account before trusting Stripe resources. | Required for any Stripe billing operation or setup command | Server/tooling | Stripe-derived access, setup, Portal, subscription validation, and Checkout fail closed. |
| `STRIPE_TEST_PAYMENT_METHOD_CONFIGURATION_ID` | Tooling-only copy of the exact sandbox card-only Payment Method Configuration (`pmc_...`) that Portal setup is allowed to pin. | Required only for `stripe:portal:*` | Local/server tooling | Portal setup cannot run. The runtime does not read this variable. |
| `STRIPE_SECRET_KEY` | Runtime Stripe secret or restricted key for Portal, subscription lookup, Checkout, and webhook support. | Required for any Stripe operation | Server | Stripe operations are unavailable. Test and live values must be scoped to separate deployments and must match the configured Price ID. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/billing/webhook`. Local Stripe CLI listeners and deployed endpoints have different secrets. Keep it configured throughout every subscription's lifetime, even while Checkout or AI access is paused. | Required for signed subscription projection | Server | Signed events cannot be projected; this is not a safe routine kill switch once subscriptions exist. |
| `STRIPE_PAYMENT_METHOD_CONFIGURATION_ID` | Pinned, remotely verified active Payment Method Configuration (`pmc_...`) for the current Stripe mode. Its effective card preference must be `on`; every surfaced non-card method must be `off`. | Required for Customer Portal access and Checkout readiness | Server | Portal and new Checkout fail closed. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Pinned, remotely verified Customer Portal v3 configuration ID (`bpc_...`) for the current Stripe mode. | Required for Customer Portal access | Server | Portal is unavailable, without disabling webhook processing, catalog verification, or other Stripe client operations. The v3 contract pins the card-only `pmc_...`, canonical billing return/privacy/terms URLs and headline, permits address/name/tax-ID and payment-card recovery, shows invoice history, and allows cancellation only at period end without proration. |
| `STRIPE_TRYHABLA_TEACHER_PRICE_ID` | Exact v3 licensed recurring Price for the $20/month Teacher plan under Product `TryHabla`. | Required for catalog verification, subscription entitlement, and Checkout | Server | Stripe-derived AI access and new Checkout fail closed. The retired two metered Price variables are rejected. |
| `STRIPE_AUTOMATIC_TAX_ENABLED` | Must remain `false` for this release. Automatic or manual tax requires a later reviewed billing-contract revision. | Required as `false` | Server | Any value other than `false` fails billing configuration closed. |
| `STRIPE_ALLOW_LIVE` | Explicit live-mode safety gate. | Required as `true` only for an approved live launch | Server | Live keys are rejected. Live mode also requires `NODE_ENV=production`. |

The Price ID, both pinned configuration IDs, the secret key, and `STRIPE_ACCOUNT_ID` must belong
to the same Stripe environment and account. TryHabla derives an immutable billing-contract ID from
that account, Stripe API version and mode, price book and catalog fingerprint, exact Price ID,
the false-only tax setting, and the card-only payment policy. An account, catalog, tax, or payment
policy change therefore creates a new contract, and old-contract rows cannot silently grant access.
Only an exact `active` Stripe subscription grants paid access; `trialing` and
all collection-problem states are non-entitled. The ordinary catalog, Payment Method Configuration,
and Portal setup commands are intentionally test-only. The separate `stripe:live:setup` command is
read-only by default and requires a live setup credential, `STRIPE_LIVE_SETUP_APPROVED=true`, every
production/live safety gate, and exact account and price-book confirmations before it performs even
a remote read; mutation additionally requires both explicit apply flags and the separate human
approval in the live checklist. The catalog runtime verifier is
read-only in both modes and requires an explicit live-read flag. Follow `docs/stripe-billing.md`
before running live setup or enabling either billing flag.

