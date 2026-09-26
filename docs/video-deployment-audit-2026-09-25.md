# Video + AI deployment audit — September 25, 2026

## Decision: NO-GO

The owner's release rule is **every category at least 8/10 with supporting evidence**. This candidate does not meet that rule. Do not deploy or enable it on the strength of the current tests. Scores measure demonstrated release readiness, not percentages of safety or legal certification. Unknown production configuration and missing external approvals reduce confidence.

Scope: local uncommitted feature changes on base commit `627f0e0`, source review, current production-dependency advisory scan, local regression tests, and official pricing/privacy guidance. Earlier teacher usage observations inform sizing; they were not refreshed during this audit. No production mutation, deployment, student-media upload to a provider, or real camera/provider/Blob end-to-end test was performed.

## Scorecard

| Category | Score | Required evidence or correction to reach 8 |
| --- | --- | --- |
| Privacy and legal readiness | 4/10 | School authorization and data-processing terms; age/location scope; applicable state/district recording requirements; verified provider and gateway retention settings, including ZDR where required |
| Security and access | 4/10 | Patch affected production dependencies; adversarial video authorization, expiry, replay and cross-account tests; verify signed Blob integration |
| Retention and deletion | 5/10 | Make video retention independent of billing reconciliation; bounded cleanup with retry monitoring; validate deletion and backup handling; align notice with actual schedule |
| Cost containment | 5/10 | Enforced media-transfer and upload-attempt budgets; full provider accounting including retries/transcription; concurrency-safe spend reservations and production configuration evidence |
| Profit confidence | 3/10 | Reconciled provider/hosting/Stripe costs and an explicitly bounded worst-case contribution-margin model |
| Recording and playback reliability | 4/10 | Correct media CSP; permission/unmount and duplicate-action safeguards; resumable/idempotent finalization; real supported-browser and poor-network tests |
| AI grading integrity | 5/10 | Grade audio derived from the submitted video; validate speech-only rubric behavior and quality; recheck processing authorization before provider calls and result delivery |
| Accessibility and student completion | 4/10 | Teacher-controlled individual accommodations; caption/transcript access; keyboard/screen-reader checks; a completion path when cameras, quota or subscription are unavailable |
| Subscription and allowance behavior | 6/10 | Concurrent quota/reset/cancellation tests; safe upload retries; confirm both paid accounts against Stripe; explain reservation accounting in the UI |
| Testing and operations | 4/10 | Green release checks; real complete video flow; alerts for upload, AI and deletion failures; validated rollback/disable procedure and configuration checklist |

## Verified local checks

- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: **975 passed, 1 failed, 976 total; 119 files passed, 1 failed**. The failure is `__tests__/legal-public-pages.test.tsx:13`, which expects the old August 26 privacy-notice date while the notice says September 24. The same test also bans the phrase `school-approved`, now present conditionally in the notice; resolve this deliberately without dropping the protection against unsupported approval claims.
- `npm audit --omit=dev`: **one critical affected package (`next`) and one high affected package (`sharp`)**. These are dependency advisories, not evidence of a successful exploit. The Windows-specific Next.js advisory does not describe this Mac; the separate image-optimization advisory must also be assessed and patched.
- No production build or full release gate was rerun in this audit. The earlier successful build does not establish browser, provider, billing, or privacy readiness.
- Feature-specific coverage is sparse: assignment persistence/required-video rejection, mocked AI draft dispatch, and mocked deletion failure. The hundreds of existing tests do not establish video end-to-end coverage.

## Findings and remediation

### 1. Privacy and legal readiness

`lib/video-policy.ts` defaults the feature off and requires environment attestations and a teacher allowlist. Those are useful enforcement switches, but cannot prove a school actually authorized recording or that a provider's retention configuration is approved. Student ages, jurisdictions, school agreements, provider/gateway contracts and backup schedules are not verified. Identify the actual approved providers, purposes, access rights, retention, deletion and incident process before activation. COPPA school consent is limited to the educational purpose; FERPA's school-official exception has direct-control and use/redisclosure conditions. OpenAI's guidance requires zero data retention before processing personal data of children under 13 or the applicable digital-consent age.

### 2. Security and access

The video GET routes use authenticated owner/student lookups; the SQL filters soft-deleted submissions/classes/assignments. PUT signatures are scoped to a random pathname, content type and 20 MiB, expire after ten minutes and disallow overwrite. Finalization checks student, assignment, reservation age and measured media duration. These are positive controls. Missing evidence includes unauthorized-account tests, signature expiry/replay, forged reservations, malformed media and cancellation races. Playback URLs are bearer capabilities, reusable for ten minutes; app-level access revocation cannot revoke a URL already issued during that window. `verifyVideoUpload` buffers and parses the complete file; bound concurrency and parsing resources.

The installed Next.js 16.3.1 falls within the published affected range for the image-optimization advisory; the advisory lists 16.3.3 as patched and npm offers 16.3.6. The installed sharp dependency is also flagged, with 0.35.4 identified as the patch threshold. Update the dependency graph and rerun the audit/build/regression checks. Do not infer that a Windows-specific vulnerability alone affects this deployment.

### 3. Retention and deletion

`app/api/cron/cleanup/route.ts` exits before deleting any video if billing reconciliation throws or blocks source cleanup. That couples student-data retention to an unrelated financial system. `listVideoObjectsForCleanup` fetches an unbounded list and deletion is sequential per object, creating a timeout risk as usage grows. Failed deletion appropriately preserves references for retry, but alerting and actual storage deletion are unverified. The daily cron means an orphan eligible after 24 hours can remain nearly 48 hours even during normal operation; a 90-day video can remain nearly 91 days. Public wording should state an honest deletion window. `VIDEO_RETENTION_DAYS` accepts up to 3,650 days and invalid values silently fall back to 90; validate against the actual school policy. Audio, transcripts, grades and provider backups have separate retention and require a complete data map.

### 4. Cost containment

The code limits active/completed video reservations to 200 per Stripe period and each object to 20 MiB; AI drafts use the existing 300-unit allowance. Playback has no per-teacher request/byte budget, and short-lived signed URLs permit repeated downloads. Cleanup cancels old orphan reservations, removing them from the quota count, so 200 is not a lifetime upload-attempt cap for the period. Repeated abandoned uploads/validation can therefore produce additional costs. The AI global budget defaults to a fixed $0.04 reservation per generation, not measured total provider spend. The existing $3 monthly grading guard checks recorded costs before work and is not an atomic reservation for all concurrent requests; it is not a verified total audio+video+AI cap. Production model routing and cost telemetry need reconciliation before claiming a hard financial ceiling.

### 5. Profit confidence and cost arithmetic

Published rates support scenarios, not an absolute profit floor. For a $20 subscription, US domestic Stripe Payments at 2.9% + $0.30 costs $0.88; Billing pay-as-you-go at 0.7%, if applicable, adds $0.14. Three cohorts of 200 full 20 MiB videos approximate 11.72 GiB stored, about $0.27 using the cited $0.023/GB-month rate (billing units and calendar/retention boundaries affect the exact amount). One validation read plus ten full plays of the newest 200 videos is about 42.97 GiB and $2.15 at $0.05/GB. This excludes playback of older retained videos, Edge Requests, origin transfer, operations and base hosting. Transcribing 300 five-minute recordings costs an estimated $9 with the code's production default gpt-4o-transcribe, or $4.50 with mini-transcribe, before grading, retries and other costs. Even before grading, the $9 transcription scenario leaves only approximately $7.56 after the illustrative Stripe/storage/transfer costs. That remainder is **not profit**. Unlimited playback and incomplete metering mean no defensible positive worst-case profit floor; losses remain possible.

### 6. Recording and playback reliability

`next.config.ts` allows media from only `self`, `blob:` and `data:`. Playback GET routes redirect to the private Blob origin, which that policy excludes. Correct the origin policy and verify redirects/range playback in browsers. `VideoResponse.tsx` has no pending-permission lock or cancellation guard: repeated starts or navigation while `getUserMedia` is pending can create overlapping streams. It uses an interval counter for duration, vulnerable to background throttling. It has no idempotency key or upload-resume state; every retry requests a new reservation and uploads again. Audio size is not checked against the server maximum before uploading the video. Test camera denial, Safari/iOS and Chrome, tab changes, maximum-duration recordings, lost responses, slow connections and teacher/student playback.

### 7. AI grading integrity

The automatic worker requests `suggestion_only`, preserving teacher review and final grading control. No video frames go to the model; this is speech-based grading of a video response. However, `store-recording.ts` accepts a separately supplied audio file and checks only that its duration is within five seconds of the video. Equal duration does not establish equal content. Extract the grading audio from the server-validated video, or adopt another verified binding strategy. Visual rubric criteria must remain explicitly for human review. The video branch calls `gradeOneSubmission` without the transcription branch's `processingStillAuthorized` callback; disabling a setting during processing does not reliably stop later work/delivery. Evaluate the actual model against representative, appropriately authorized speech/rubric fixtures before setting an accuracy score.

### 8. Accessibility and student completion

Optional video retains audio submission, but required video has no individual accommodation override. A missing/blocked camera, exhausted teacher quota or lapsed subscription can prevent assignment completion. Add a teacher-controlled exception and clear teacher/student recovery path without silently overriding the teacher's requirement. Video elements lack caption tracks, and no keyboard, screen-reader or device accessibility review has been completed. The student notice says “if” automatic grading is on rather than clearly showing the assignment's actual setting.

### 9. Subscription and allowance behavior

Reservation creation rechecks active Stripe status and period inside a database transaction, a useful safeguard against exceeding the concurrent reservation count. Finalization checks reservation period expiry but does not recheck current paid status; explicitly decide and test whether an already-authorized upload should remain valid after cancellation. The owner identified two accounts as the initial usage guidelines. Observed activity varied substantially, historical duration coverage was incomplete, and one account's local billing projection needed reconciliation with Stripe. Identifying usage and billing details are omitted from this public copy. A small sample does not forecast future video usage; reconcile paid entitlements before activation. Test renewal boundaries, subscription replacement, concurrent uploads, cleanup quota refunds and failed-finalization retries.

### 10. Testing and operations

The feature has not completed a real record → private upload → duration validation → submission → AI draft → teacher approval → student playback → deletion flow. Neither a green typecheck nor mocked tests substitute for this evidence. The release script currently validates registration policy and generic checks, not video storage/AI/retention prerequisites. Add configuration validation and operational alerts that avoid student content and signed URLs. Verify failure recovery and disabling behavior, including already-running jobs and outstanding signed URLs. Review the exact committed candidate after remediation; do not deploy on a calendar deadline alone.

## Required order before reassessment

1. Patch affected dependencies and correct media CSP; resolve the legal-notice test deliberately.
2. Fix upload retry/idempotency and camera lifecycle; bind grading audio to the submitted video; add authorization and quota race tests.
3. Separate retention from billing; bound and monitor deletion; verify the actual deletion windows and provider backup policy.
4. Enforce and meter realistic spend budgets; reconcile production configuration and the two paid accounts; recalculate contribution margin.
5. Add individual accommodations and clear AI/retention notices; complete school/provider approvals for the actual ages and jurisdictions.
6. Complete browser/provider/storage integration and release checks, then rescore every category. Keep the release blocked if any remains below 8.

## Primary sources checked

- [FTC COPPA FAQ, school authorization and operator obligations](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
- [U.S. Department of Education, FERPA school-official conditions](https://studentprivacy.ed.gov/faq/who-school-official-under-ferpa)
- [OpenAI under-18 guidance](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [Vercel Blob pricing and delivery charges](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- [Stripe pricing](https://stripe.com/pricing)
- [Next.js image-optimization advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4)
- [Next.js Windows-hosted server advisory](https://github.com/advisories/GHSA-p293-qw3h-jr36)
- [sharp/libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)
