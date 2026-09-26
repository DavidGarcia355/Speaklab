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

The branch must be checked after incorporating the latest `origin/main`: complete automated suite, lint, TypeScript, production build, dependency audit, and whitespace checks. Record actual results in the branch handoff; do not equate these checks with completed real-service verification.
