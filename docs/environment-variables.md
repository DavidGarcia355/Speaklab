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
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob uploads, reads, and deletion. | Required for production audio workflows. | Server | Upload/playback/delete operations fail safely; unrelated routes should not fail. |

Student audio uploads must use private/access-controlled Blob storage. Public fallback is disabled.

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
| `DISCORD_WEBHOOK_URL` | Founder activity/feedback webhook. | Optional | Server | Discord notifications are skipped. |

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
| `AI_TRANSCRIPTION_MODEL` | Transcription model ID. | Optional | Server | Defaults to `whisper-1` for OpenAI. Model changes require adapter validation. |
| `AI_GRADING_MODEL` | Grading model ID. | Optional | Server | Defaults to `gpt-4o-mini` for OpenAI. |
| `AI_ACCESS_MODE` | `paid` uses manual entitlements; `all` allows every authenticated teacher. | Optional | Server | Defaults to `paid`; production fails closed if `all` is combined with open teacher self-registration. |
| `AI_TEACHER_DENYLIST` | Comma-separated emergency account suspension list in either access mode. | Optional | Server | No accounts are denied. |
| `AI_STUDENT_DATA_APPROVED` | Explicit production gate after student-data, disclosure, retention, district, and OpenAI data-control review. | Required for production AI | Server | Production provider calls fail closed and `/api/features` hides AI. |
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
| `OPENAI_API_KEY` | Direct OpenAI transcription/grading project key. | Required locally when either provider is `openai` and AI Gateway is unavailable | Server | Vercel production prefers AI Gateway OIDC; direct-provider requests fail closed when no hosted credentials exist. |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway credential for non-Vercel runtimes. | Optional | Server | Deployed Vercel functions use the rotating `VERCEL_OIDC_TOKEN` automatically. |
| `OLLAMA_URL` | Prototype grading model endpoint. | Optional/experimental | Server | Defaults to local URL in prototype code only when AI is enabled. |
| `OLLAMA_MODEL` | Prototype grading model name. | Optional/experimental | Server | Defaults to `llama3.2` in prototype code only when AI is enabled. |

