# Habla Production Readiness Audit

Date: 2026-08-16  
Production URL: https://tryhabla.com  
Latest audited commit: `9f0b1f7` (`Fix playback for browser data URL recordings`)

## Executive Summary

Habla is currently deployed and the public/protected endpoint smoke checks pass, but this should not be treated as fully production-certified for live teacher rollout yet.

The immediate student submission outage was caused by production Vercel Blob being configured as a public-only store while the app uploads student audio with `access: "private"`. A functional fallback is now deployed: on that exact Blob error, submissions store the audio data URL in the database, and teacher playback/AI grading can read it through authenticated server routes.

That fallback restores functionality, but it is a stopgap. The highest-priority production work is to replace the public Blob store with a private/access-controlled Blob store, remove the database-audio fallback, migrate any legacy/public audio, and add authenticated end-to-end smoke coverage.

## What Was Fixed During This Audit

1. Student submit fallback for public-only Blob store
   - File: `app/api/assignments/[assignmentId]/submissions/route.ts`
   - Relevant lines: `31`, `98-101`
   - Behavior: if Vercel Blob throws `Cannot use private access on a public store`, the route stores the submitted audio data URL in the DB instead of failing the submission.

2. Browser audio data URL parsing
   - File: `lib/validation.ts`
   - Relevant lines: `266-305`
   - Behavior: accepts browser metadata such as `data:audio/webm;codecs="opus,pcm";base64,...`.

3. AI legacy audio read compatibility
   - File: `lib/ai/audio.ts`
   - Relevant lines: `4`, `10-21`
   - Behavior: AI grading can read the same browser data URL shapes.

4. Teacher playback compatibility for DB-stored recordings
   - File: `app/api/submissions/[submissionId]/audio/route.ts`
   - Behavior: protected playback now uses the shared audio parser, so recordings stored as browser data URLs still play.

## Verification Already Run

Local verification:

```text
npm run lint                 PASS
npm test                     PASS, 18 files / 106 tests
npm run typecheck            PASS
npm run build                PASS
```

Focused coverage added/confirmed:

```text
npm test -- audio-privacy submissions audio-data-url ai-route-mock
PASS, 21 tests
```

Live smoke checks:

```text
GET https://tryhabla.com/api/health              200 OK
GET https://tryhabla.com/api/features            200 OK, AI enabled with OpenAI/OpenAI
GET https://tryhabla.com/api/classes             401 when signed out
GET https://tryhabla.com/api/student/submissions 401 when signed out
GET https://tryhabla.com/api/submissions/test/audio 401 when signed out
GET https://tryhabla.com/api/cron/cleanup        403 without cron secret
```

Live Vercel logs confirmed the original submit failure:

```text
Vercel Blob: Cannot use private access on a public store. The store must be configured with private access.
```

## P0 / Release-Blocking Findings

### P0-1: No Authenticated End-To-End Production Smoke Test

Status: unresolved.

The app has good unit/API coverage, but there is no automated test that signs in as a real teacher/student and completes the full production workflow:

1. teacher creates class
2. teacher creates assignment
3. student signs in
4. student records/uploads/submits
5. teacher loads class
6. teacher plays audio
7. teacher generates AI suggestion
8. teacher saves grade
9. student sees grade/feedback

Risk: we keep discovering bugs one step later in the workflow because local tests mock too much of the browser/auth/storage stack.

Suggested fix:

- Add Playwright.
- Create dedicated production smoke accounts or preview/staging accounts.
- Run a short synthetic audio upload through the real app after every production deploy.
- Make the smoke test fail loudly if submit, playback, AI generation, or grade save fails.

## P1 / High Priority Findings

### P1-1: Production Blob Store Is Public-Only; App Is Using DB Audio Fallback

Status: functional workaround deployed, architecture unresolved.

Evidence:

- Upload code expects private Blob: `lib/audio-storage.ts:19`
- Production logs showed private upload is rejected by the store.
- Fallback now stores audio in DB: `app/api/assignments/[assignmentId]/submissions/route.ts:98-101`
- DB schema supports `audio_data` and `audio_blob_url`: `lib/db.ts:291-292`
- Submission insert writes fallback audio into `audio_data`: `lib/db.ts:905-906`

Risk:

- Base64 audio in Turso can grow quickly and may hit row/database/performance limits.
- AI grading reads the whole audio buffer from DB when fallback is used.
- Cleanup deletes DB rows eventually, but does not manage external storage for data URLs because there is no external object.
- Current docs are now inaccurate because they claim no fallback/public Blob issue remains.

Suggested fix:

- Create/configure a private/access-controlled Vercel Blob store.
- Rotate `BLOB_READ_WRITE_TOKEN` to that private store.
- Verify private `put(..., { access: "private" })` succeeds in production.
- Migrate DB `audio_data` rows to private Blob pathnames.
- Remove the production DB fallback once private Blob is verified.
- Add a production health check that validates private Blob write/read/delete with a tiny object.

### P1-2: Dependency Audit Has Critical/High Findings

Status: unresolved.

`npm audit --audit-level=moderate` reports 16 vulnerabilities, including:

- `next-auth <=4.24.14`: critical advisories.
- `next 16.1.1`: high advisories; fix suggested outside current range.
- `postcss`, `sharp`, `vite`, `undici`, `ws`, and others with high advisories.

Risk:

- Auth and framework vulnerabilities are not acceptable for production handling student data.

Suggested fix:

- Branch and run `npm audit fix`.
- If needed, evaluate `npm audit fix --force` carefully because it moves Next to `16.3.1`.
- Run full app checks and at least one authenticated smoke test after dependency updates.
- Prioritize `next-auth`, `next`, `undici`, and build/runtime dependencies over dev-only transitive packages.

### P1-3: AI Grading Is Enabled In Production Before Privacy/Cost Controls Are Fully Proven

Status: enabled.

Evidence:

- Feature endpoint reports AI enabled.
- Production env contains AI keys/providers.
- AI route gates real use by paid flag: `app/api/submissions/[submissionId]/ai-grade/route.ts:107`
- App-level daily caps exist: `lib/ai/config.ts:65-66`
- OpenAI receives student audio/transcript when enabled: `lib/ai/providers.ts:22-31`, `105-109`
- AI attempts persist transcript/feedback in DB: `lib/db.ts:1726`

Risk:

- Student audio/transcripts are sent to OpenAI.
- AI transcripts and suggestions are persisted.
- There is no verified OpenAI hard spend cap in code.
- There is no production admin dashboard for AI usage/cost.
- Existing docs still say AI is disabled by default/currently disabled, which is false for production now.

Suggested fix:

- Confirm OpenAI org hard spend limit in the OpenAI dashboard.
- Add admin AI usage counts by day/teacher.
- Add copy in UI/admin that AI is experimental and teacher-reviewed.
- Update privacy/subprocessor docs before external rollout.
- Consider disabling AI in production until the live submit/playback workflow has one full authenticated smoke pass.

### P1-4: Documentation Is Now Stale And Overstates Privacy Posture

Status: unresolved.

Examples:

- `docs/district-security-overview.md:25` says the app no longer falls back to public Blob storage. The app now has a DB fallback for public-only Blob errors.
- `docs/district-security-overview.md:37` says AI grading is disabled by default. Production currently has AI enabled.
- `docs/data-retention-and-deletion.md:17` says no persistent AI result table currently exists. `ai_grading_attempts` exists and persists transcripts/suggestions.

Risk:

- Sending stale docs to a school/district creates trust/compliance risk.

Suggested fix:

- Update all public/security/privacy docs to match production reality.
- Separate "source supports" from "production verified".
- Add a simple `docs/live-production-status.md` that gets updated after deploys.

## P2 / Medium Priority Findings

### P2-1: Assignment Attachments Remain Public

Status: known gap.

Evidence:

- Docs already call this out in `docs/compliance-gap-register.md`.
- Attachment storage uses public-ish direct URLs, unlike protected audio.

Risk:

- Teachers may upload worksheets or directions containing student/class context.

Suggested fix:

- Either explicitly restrict attachments to non-sensitive assignment directions or move attachments behind authenticated/protected routes.

### P2-2: Student Submit Error Copy Is Misleading

Status: partially mitigated by fallback.

The submit route still maps generic Blob upload failures to:

```text
We couldn't upload your recording right now. If you're on a school network...
```

File: `app/api/assignments/[assignmentId]/submissions/route.ts:110`

Risk:

- Actual platform/storage errors get blamed on the student's network.

Suggested fix:

- Return distinct messages for storage configuration failure, rate limit, unsupported audio, and network/browser failures.
- Log a stable error code server-side and show a less misleading student-facing message.

### P2-3: No Production Blob Capability Health Check

Status: unresolved.

`/api/health` only returns status/timestamp. It does not verify DB, Redis, Blob, auth config, cron secret, or AI provider readiness.

Suggested fix:

- Keep public `/api/health` shallow.
- Add admin-only `/api/admin/health/deep` that checks:
  - Turso query
  - Upstash ping/rate-limit operation
  - Vercel Blob private put/get/delete
  - AI provider config only, not a model call by default
  - cron secret presence

### P2-4: CSV Parsing Is Naive

Status: unresolved.

The roster CSV parser splits on commas in the browser. It does not correctly handle quoted names with commas.

Risk:

- Some school exports can import incorrectly.

Suggested fix:

- Use a small CSV parser library or a tested local parser.

## P3 / Cleanup

### P3-1: Local Workspace Has Untracked Audio

Status: unresolved but not deployed.

File:

```text
scratch-speech.wav
```

Risk:

- Low if left untracked; moderate if accidentally committed.

Suggested fix:

- Delete it or add an explicit ignore pattern for scratch audio files.

## Recommended Claude Code Task List

1. Add Playwright authenticated smoke tests for teacher/student critical path.
2. Add production deep-health endpoint gated by admin.
3. Fix Vercel Blob store to private/access-controlled storage.
4. Write migration from DB `audio_data` and public Blob URLs to private Blob pathnames.
5. Remove production DB-audio fallback after storage is verified.
6. Run dependency upgrade branch for `next`, `next-auth`, and audit findings.
7. Update docs to match live production AI/storage behavior.
8. Add AI usage/cost admin reporting and verify OpenAI hard spend cap.
9. Improve submit/playback error codes and user-facing messages.
10. Replace browser CSV split parser with real CSV parsing.

## Current Go / No-Go

Go for a very small internal smoke test with trusted accounts: yes, after confirming a teacher can submit/playback/AI-grade one test recording manually.

Go for broad live teacher rollout: no. The app is functional, but storage architecture, authenticated E2E coverage, dependency audit, and stale docs need attention first.
