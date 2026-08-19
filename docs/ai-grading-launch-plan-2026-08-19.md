# AI grading launch audit and plan — 2026-08-19

## Executive decision

The application is now safer to deploy with AI grading still disabled. Single-submission grading is prepared for an approved OpenAI pilot; synchronous bulk grading is separately disabled by default.

Do not enable real-student OpenAI calls until all four external launch gates are complete:

1. Create a separately billed OpenAI API project/key and configure a provider-side hard spend limit and alerts. A ChatGPT subscription does not fund API usage.
2. Complete the minors/student-data review, including OpenAI data controls or Zero Data Retention where required, DPA/subprocessor approval, district approval, disclosure, and a truthful public privacy policy.
3. Keep teacher self-registration closed before setting `AI_ACCESS_MODE=all`, inventory current teacher accounts, and constrain identity-provider tenants.
4. Verify the production private Blob store with a synthetic upload, playback, AI, deletion, and failure-recovery smoke test.

`AI_STUDENT_DATA_APPROVED=true` is an operator attestation, not evidence that those reviews occurred. The app-side `$200` reservation ceiling is conservative nominal accounting, not the OpenAI billing system's hard ceiling.

## Current request flow

```text
Teacher class page
  -> GET /api/features
     -> returns readiness, access mode, and separate single/bulk flags

  -> POST /api/submissions/:submissionId/ai-grade
     -> teacher authentication
     -> production configuration + student-data gate
     -> denylist and paid/all-access policy
     -> submission ownership and generation/cooldown/daily limits
     -> atomic nominal monthly budget reservation
     -> authorized audio download
     -> OpenAI audio transcription (default: whisper-1)
     -> duration/language/quality validation
     -> OpenAI structured grading (default: gpt-4o-mini)
     -> strict rubric-ID/output validation
     -> persist completed or sanitized failed attempt
     -> return a draft suggestion for teacher review

  -> GET/POST /api/assignments/:assignmentId/ai-grade-all
     -> separately gated by AI_BULK_GRADING_ENABLED
     -> disabled by default because it is synchronous and not resumable
```

Main implementation areas:

- UI and feature discovery: `app/teacher/class/[classId]/page.tsx`, `app/api/features/route.ts`
- Single orchestration: `app/api/submissions/[submissionId]/ai-grade/route.ts`
- Bulk orchestration: `app/api/assignments/[assignmentId]/ai-grade-all/route.ts`, `lib/ai/grade-one.ts`
- Provider and prompt contracts: `lib/ai/providers.ts`, `lib/ai/schemas.ts`
- Configuration, cost guard, and errors: `lib/ai/config.ts`, `lib/ai/budget.ts`, `lib/ai/errors.ts`
- Attempts and quotas: `lib/db.ts`

## Improvements completed in this launch branch

| Change | Expected benefit | Tradeoff / limitation |
| --- | --- | --- |
| Explicit OpenAI timeout, bounded retries, singleton client, and output-token limit | Bounded latency and fewer transient failures | SDK retries can still incur cost; actual usage reconciliation is not implemented |
| Strict Structured Outputs with bounded Zod schema and exact rubric IDs | Fewer malformed results and no silent zeroes for missing criteria | More suggestions correctly return unable-to-grade |
| Transcript-only evidence policy and manual-review result for audio-only criteria | Prevents unsupported pronunciation/prosody claims | Automates fewer rubric criteria |
| Sanitized provider errors | Safer persistence and clearer teacher messages | Detailed diagnostics need internal correlation/request telemetry later |
| Production student-data gate and teacher emergency denylist | Fail-closed launch and fast account suspension | Environment controls are not a full governance or account-suspension system |
| `paid` or `all` access modes, with production rejection of `all` plus open registration | Supports an approved free-teacher pilot without an obvious signup cost-abuse path | Existing teacher inventory and tenant controls remain operational requirements |
| Atomic UTC-month nominal budget reservation, plus failed-attempt quota counting | Reduces concurrent overspend and failure loops | Reservation uses an estimate; the provider project limit remains authoritative |
| Separate bulk feature flag, default off | Avoids serverless timeout, duplicate spend, and invisible partial batches | No class-wide one-click grading until durable jobs exist |
| OpenAI media extensions preserved; grading uses `store: false` | Better transcription compatibility and lower application-state retention | `store: false` does not replace OpenAI ZDR/data-control approval |
| Student-facing AI disclosure beside recording controls | Improves transparency | Legal/guardian/district disclosure still needs approval |
| Assignment-edit, duplicate-rubric-ID, and graded-submission-delete fixes | Protects assignment and grade integrity around the AI workflow | Other non-AI launch findings remain below |
| Next/NextAuth security upgrades and hardened Docker context/non-root runtime | Removes known production dependency findings and reduces secret/container risk | Development-tool advisories must be managed separately |

## Recommended implementation sequence

### Phase 0 — external approval and safe pilot activation

1. Create an OpenAI API project dedicated to production, enable billing, set a hard project spend limit/alerts, and create a least-privilege project service-account key.
2. Complete student/minor-data review and publish approved privacy/terms pages. Confirm OpenAI retention controls or ZDR before processing protected under-age personal data.
3. Keep `ALLOW_TEACHER_SELF_REGISTRATION=false`; decide exactly which school tenants/accounts qualify for “free for everyone.”
4. Configure Vercel with OpenAI providers, the key, conservative daily limits, `$200` app reservation, bulk disabled, and AI still globally disabled.
5. Run synthetic production smoke tests, inspect logs/storage/deletion, then enable single grading for a small approved cohort before widening access.

### Phase 1 — cost, reliability, and latency

1. Add a transactional `pending` attempt with a unique idempotency key derived from the audio version, rubric/assignment hash, models, prompt version, and schema version.
2. Cache transcription separately from grading. Reuse compatible completed suggestions and require an explicit teacher action to regenerate.
3. Record trusted media duration and size before provider calls so overlong audio is rejected before paid transcription.
4. Reconcile nominal reservations with actual provider usage; add admin usage/cost/limit telemetry and alerts.
5. Centralize single and bulk orchestration into one staged service so quota, persistence, retry, and error behavior cannot drift.

### Phase 2 — durable bulk and UI readiness

1. Replace synchronous bulk HTTP work with durable jobs and per-submission idempotency.
2. Add bounded concurrency, progress polling or server-sent events, cancellation, resume, and stale-job recovery.
3. Return eligibility, denial reason, remaining quota, and budget readiness from the feature endpoint so controls are disabled before a teacher gets a 402/429.
4. Stream job progress only; do not stream partial unvalidated grading JSON into the teacher workflow.

### Phase 3 — quality and model evaluation

1. Build a privacy-approved, representative eval set with teacher-scored examples, accents/dialects, noise, code-switching, empty/off-topic audio, and adversarial transcript instructions.
2. Keep `gpt-4o-mini` as the behavior-compatible baseline. Compare current [OpenAI models](https://developers.openai.com/api/docs/models), especially cost-sensitive GPT-5.6 Luna and balanced GPT-5.6 Terra, only after the eval harness exists.
3. Add a model-aware transcription adapter before comparing Whisper with newer transcription models; their response formats are not drop-in identical.
4. Measure teacher agreement, grounded evidence, unable-to-grade calibration, p50/p95 latency, retry rate, and provider cost per accepted suggestion.
5. Consider a Responses API migration after contract tests. Do not add web search, file search, or other built-in tools to grading without a specific product need; they add nondeterminism, latency, cost, and data exposure.
6. Treat direct-audio/multimodal grading as a separate product and fairness evaluation. Transcript text cannot establish pronunciation, pacing, prosody, accent intelligibility, or audio quality.

## Validation plan

Automated checks for every AI change:

- Configuration: disabled, missing key, missing student-data approval, broad access with open registration, denylist, bulk off/on.
- Authorization: unpaid/paid/all-mode teacher, ownership, unknown/suspended teacher, no final-grade mutation.
- Provider contract: exact OpenAI request, MIME/extension variants, strict structured success, refusal, malformed/incomplete output, 408/429/5xx, timeout, and exhausted retries.
- Schema/adversarial: duplicate/missing/unknown rubric IDs, bounded text/arrays, empty/off-topic transcript, prompt injection, and audio-only rubric criteria.
- Cost/concurrency: simultaneous requests for one submission, single-versus-bulk races, failure consuming quota, monthly boundary, reservation exhaustion, stale pending recovery, and idempotent retry.
- Data lifecycle: attempt reload, explicit regeneration, rubric invalidation, submission deletion cascade, retention expiry, Blob deletion failure and retry.

Lightweight live validation should use only synthetic audio in a non-production or approved pilot project. Record request IDs, model identity, stage latency, retry count, token/audio usage, estimated versus actual cost, and result disposition. Never run live-provider tests in the default unit-test suite.

## Product or infrastructure decisions still required

- Who exactly is included in “free for everyone”: every existing teacher, approved school tenants, invited cohorts, or public signup?
- Which student ages/districts can use OpenAI, and what consent/disclosure/retention/ZDR rules apply?
- Is automatic scoring limited to transcript-observable criteria, or will the product fund and validate a direct-audio path?
- What is the final monthly provider hard limit, per-teacher fair-use policy, alert threshold, and response when the budget is exhausted?
- Which queue/worker and telemetry stack will run durable bulk grading?
- How long should transcripts, AI suggestions, evidence, errors, and usage metadata be retained?
- Should attachments or other multimodal context be sent to the model? This requires separate privacy, prompt-injection, and eval work.

## Other launch blockers found during the audit

- `/api/health` can report success after a database failure; it should fail readiness checks accurately.
- Cleanup deletes database references before confirming Blob deletion, preventing reliable retry of orphaned student media.
- The public privacy policy route is missing and the draft contains unresolved placeholders.
- Student audio upload is base64 JSON and can create multiple large memory copies; production should move toward direct/streamed upload with server-side media probing.
- Mutable email is the durable account identity; long term, migrate authorization to immutable provider issuer/subject identities and explicit account links.
- Add required GitHub CI for test, lint, typecheck, build, production dependency audit, secret scanning, and dependency updates.

## OpenAI guidance used

- [Models](https://developers.openai.com/api/docs/models)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Production best practices](https://developers.openai.com/api/docs/guides/production-best-practices)
- [Under-18 API guidance](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance)
- [Data controls](https://developers.openai.com/api/docs/guides/your-data)
- [Speech to text](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Migrate to Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses)
