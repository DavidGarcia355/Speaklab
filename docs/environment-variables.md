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
| `AUTH_MICROSOFT_ID` | Enables optional Microsoft/Azure AD sign-in. | Optional | Server | Microsoft provider is not registered. |
| `AUTH_MICROSOFT_SECRET` | Microsoft OAuth secret. | Required only with Microsoft provider. | Server | Microsoft sign-in will not work if provider is enabled without a valid secret. |
| `AUTH_MICROSOFT_TENANT_ID` | Microsoft tenant. Defaults to `common`. | Optional | Server | Uses `common`. |

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

Student audio and assignment attachments must use private/access-controlled Blob storage. Public
fallback is disabled for new media. Keep both static migration tokens out of Vercel; production
runtime needs only the linked private store and `AUDIO_BLOB_STORE_ID`.

The migration is dry-run by default:

```bash
node scripts/migrate-public-audio-to-private.mjs
```

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
| `ADMIN_EMAILS` | Comma-separated emails allowed to view `/admin`; also grants teacher access on sign-in. | Optional | Server | Falls back to the legacy `ADMIN_EMAIL`. |
| `ADMIN_EMAIL` | Legacy single-admin setting, merged with `ADMIN_EMAILS`. | Optional | Server | Admin page/API deny access when both admin settings are empty. |
| `RESEND_API_KEY` | Teacher confirmation and feedback notification email. | Optional | Server | Email sends are skipped. |
| `DISCORD_WEBHOOK_URL` | Generic founder event webhook; current messages contain no account, contact, school, message, or student identifiers. | Optional | Server | Discord notifications are skipped. |

## Cron

| Name | Purpose | Required | Scope | Absent behavior |
| --- | --- | --- | --- | --- |
| `CRON_SECRET` | Authorizes cleanup cron route. | Required for production cleanup. | Server | Cleanup route denies requests. |

## School And Role Controls

| Name | Purpose | Required | Scope | Absent behavior |
| --- | --- | --- | --- | --- |
| `TEACHER_ALLOWLIST` | Comma-separated emails promoted by default and allowed to self-register in production. | Optional | Server | No allowlisted teachers. |
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
| `AI_ACCESS_MODE` | `paid` uses manual entitlements; `all` allows every authenticated teacher. | Optional | Server | Defaults to `paid`; production fails closed if `all` is combined with open teacher self-registration. |
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

The repository's low-cost candidate explicitly pins OpenAI providers,
`AI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe`, `GRADING_DEFAULT_MODEL=gpt-5-nano`,
`GRADING_ESCALATION_MODEL=gpt-5-mini`, and `GRADING_AUDIO_STRATEGY=transcribe_then_grade` (plus the
same legacy `AI_GRADING_MODEL` while that fallback remains). Treat the whole set as a candidate,
not approval: benchmark grading quality and cost, verify the adapters and provider controls, and
record the exact chosen IDs before setting the versioned student-data gate.

Provider-request limits and customer billing units are deliberately different. Transcription,
grading, a bounded formatting retry, or escalation can create multiple provider requests for one
logical result. The limits above bound that provider work. Stripe records at most one successful-grade
unit for one valid, unique, non-cache, non-deterministic result; internal retries and failed provider
requests do not create additional customer charges.

## Stripe Teacher AI Billing (v2)

The active teacher price book is `habla-teacher-ai-usd-v2`: $0.05 per successful grade plus $0.01
per processed audio minute. AI feedback is included and has no separate Stripe Price or environment
variable. Keep all Stripe values server-only; never expose them through a `NEXT_PUBLIC_*` name.

| Name | Purpose | Required | Scope | Absent behavior |
| --- | --- | --- | --- | --- |
| `STRIPE_BILLING_ENABLED` | Master switch for teacher AI Checkout, subscription access, and usage delivery. Enable it last. | Optional | Server | Defaults disabled; core Habla remains available and billing routes fail closed. |
| `STRIPE_TEST_SECRET_KEY` | Test/sandbox credential used only by `scripts/stripe-setup.ts` to inspect or provision the v2 test catalog. | Required only for `npm run stripe:catalog:plan` and `npm run stripe:catalog:test:apply` | Local/server tooling | The catalog command cannot run. Live keys are rejected, and the runtime does not read this variable. |
| `STRIPE_SECRET_KEY` | Runtime Stripe secret for Checkout, Portal, subscription lookup, meter events, and webhook support. | Required when billing is enabled | Server | Billing configuration is unavailable. Must be from the same Stripe mode/account as both configured Price IDs. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/billing/webhook`. Local Stripe CLI listeners and deployed endpoints have different secrets. | Required when billing is enabled | Server | Billing configuration is unavailable and signed events cannot be projected. |
| `STRIPE_AI_GRADE_PRICE_ID` | v2 monthly metered Price for `habla_ai_successful_grade` at 5 cents per unit. | Required when billing is enabled | Server | Billing configuration is unavailable. |
| `STRIPE_AI_AUDIO_SECONDS_PRICE_ID` | v2 monthly metered Price for `habla_ai_audio_seconds` at `0.016666666667` cents per second, equivalent to 1 cent per minute. | Required when billing is enabled | Server | Billing configuration is unavailable. |
| `STRIPE_AUTOMATIC_TAX_ENABLED` | Enables Stripe Automatic Tax on Checkout after the Stripe account is configured for it. | Optional | Server | Defaults to `false`. |
| `STRIPE_ALLOW_LIVE` | Explicit live-mode safety gate. | Required as `true` only for an approved live launch | Server | Live keys are rejected. Live mode also requires `NODE_ENV=production`. |

Both Price IDs must come from the same Stripe environment as `STRIPE_SECRET_KEY` and must carry the
v2 catalog identity. The repository catalog command is intentionally test-only; live meters,
Products, and Prices require a separately reviewed manual setup. Follow
`docs/stripe-billing.md` before enabling billing.

