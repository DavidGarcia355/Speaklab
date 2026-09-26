# Video release review — September 26, 2026

**Status: review branch; video activation remains blocked.** This update supplements the September 25 audit; it does not replace its findings with passing scores. Keep video and video AI flags disabled until the remaining release checks pass. A GitHub push or preview build is not approval to enable student video in production.

## Implemented since the audit

- Updated Next.js and eslint-config-next to 16.3.6, sharp to 0.35.4, and vulnerable transitive dependencies. The local production dependency audit reported zero known vulnerabilities.
- Authenticated same-origin private video playback, range validation, and atomic per-teacher reservations for playback/validation requests and bytes. Browser clients receive no signed playback URL.
- Stable upload IDs, idempotent completed-submission recovery, 200 reserved/completed uploads per Stripe period, and a 400-authorization-attempt ceiling including cancelled reservations.
- Server-side extraction of the submitted video's audio for speech grading. Video frames and appearance are excluded from AI grading; suggestions require teacher review.
- Recorder permission/unmount handling, size and duration limits, and teacher-managed individual audio accommodations for required-video assignments.
- Additional authorization, resource-concurrency, retry, cleanup, and validation regression tests.
- Video cleanup before billing reconciliation, bounded cleanup batches, reference preservation on failure, and privacy/retention wording aligned with delayed cleanup. Retention configuration is restricted to 1–90 days.
- AI authorization rechecks before provider work and result delivery. Already-started provider requests may still finish.

## Remaining release blockers

1. Complete a synthetic real-service flow: record → upload → server extraction → submission → transcription → AI draft → teacher review → playback → deletion, including Chrome, Safari, mobile, denied permissions, and interrupted networks. Local homepage rendering alone is not this verification. Local auth configuration currently needs completion for authenticated browser checks.
2. Verify production private-store configuration, provider retention/data controls, cleanup operation and backlog recovery, backup/deletion behavior, and Stripe subscription reconciliation. No production settings have been certified by this branch.
3. Finish an auditable whole-subscription cost bound, including AI retries/concurrency, transcription, proxy delivery, operations, and fixed-cost allocation. The new video budgets alone do not establish a guaranteed profit floor.
4. Determine supported student age/jurisdiction/use scopes from authoritative requirements and implement any necessary restrictions, notices, acceptance records, and institutional controls. No school, parent, or provider approval has been fabricated; requirements must be evaluated for the actual supported use, not assumed universal.
5. Verify captions/transcript access, keyboard and screen-reader behavior, required-video accommodations, renewal boundaries, and cancellation behavior end to end.

The original audit categories cannot yet all be confidently rated 8/10. Production video activation is therefore not authorized by this review snapshot. Existing feature flags default off and teacher allowlisting and separate video-AI gates remain in place.

## Review verification

Fresh local checks on implementation commit `b26b11b15f8978e188d05459679acfa78b267fe4`, rebased onto `origin/main` at `c4a2e94`:

- `npm test`: 122 test files, 991 tests passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm audit --omit=dev --json`: zero known production dependency vulnerabilities.
- `git diff origin/main...HEAD --check`: passed.
- Added-content scan for common private-key and credential formats: no matches; this is not a comprehensive secret-detection guarantee.

Teacher identities and account-specific usage/billing details were removed from the public audit documents. Unrelated local Mac-development setup edits were preserved locally and excluded from this feature branch. These checks do not establish completed browser, real-service, financial, or legal release verification.


## Transcript-only video grading follow-up

Code tracing found the shared grading service could select a direct-audio Gemini route under compatible format/configuration settings. Video grading now forces the transcript route and independently refuses the direct-audio call. A durable video-origin marker is included in automatic, individual, and bulk review queries and survives video cleanup. Video review identities cannot reuse earlier audio-grading reviews, and video results remain suggestions for teacher review.

This restriction applies to the **grading** model. Transcription is still external: production code defaults to OpenAI `gpt-4o-transcribe`, routed through Vercel AI Gateway on Vercel unless disabled. Gateway can also select a configured provider-prefixed transcription model. Actual deployed model settings, gateway routing, and retention approvals remain unverified. The branch does not implement local/self-hosted speech recognition and does not claim that all AI providers receive text only.

Transcripts themselves can contain personal data. OpenAI's under-18 guidance applies its zero-data-retention condition to personal data below age 13 or the applicable digital-consent age, including text; changing the representation does not remove that requirement. Source: [official OpenAI guidance](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance), checked September 26, 2026.

Follow-up verification: all 122 test files / 993 tests passed, including forced-direct-route rejection, transcription-failure handling, distinct review identities, and persistent video-origin checks after cleanup. Lint, standalone TypeScript checks, and the production build passed. No real student recording was sent to a provider during these tests.
