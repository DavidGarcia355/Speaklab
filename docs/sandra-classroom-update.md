# Classroom audio update — implementation notes

## Existing pipeline traced before changes

- `student-assignment-client.tsx`: microphone capture, size/time stop, local Blob playback, data-URL POST, submission limit and duplicate guards.
- `api/assignments/[assignmentId]/submissions`: authenticated student and class policy, rate limit, strict audio data URL/size validation, `assertRecordingDuration` packet inspection, private Blob storage, transactional `createSubmission`, orphan cleanup, optional automatic transcript queue.
- `submissions`: audio reference, student identity, feedback/grade and soft deletion; originally required an assignment. The server measured duration but did not persist it. Transcript rows separately held provider-reported duration.
- Teacher/student protected audio endpoints authorize each request. History and portfolios return protected URLs, never storage references. Existing cleanup scans soft-deleted submissions.
- `transcribeOneSubmission`: authorized audio fetch, stable recording/context identity, transcript persistence and atomic allowance delivery. Transcript and subsequent grading reuse the existing semantic key and reservation. This contract must remain unchanged for assignments.
- Class enrollment is represented by the roster. Open Mic creation requires roster membership, in addition to the existing domain policy; a guessed class ID is insufficient.

## Implemented workflow

New microphone recordings and existing audio files use one shared recorder/preview form and `storeRecording` service. The service validates the data URL, MIME/bytes, size and media duration before private storage, then creates the submission transactionally with compensating blob cleanup on failure. Accepted containers are MP3, M4A/audio-only MP4, WAV, Ogg and WebM. The existing 3 MB ceiling, assignment duration limits, five-minute hard ceiling, submission limits and one-minute duplicate protection remain in place.

Students open an enrolled class, choose Open Mic, optionally add a title/note, record or select audio, preview it, and send it to their teacher. No assignment row or rubric is created. Practice appears in that student's Open Mic history and My Recordings. Teachers open Class → Practice Inbox to listen, download the original audio, optionally transcribe/copy/download text, save feedback, and mark reviewed. Practice also appears in the existing student oral portfolio. The existing student removal and retention paths apply.

The server persists measured duration. The shared player and transcript views use that value. Historical rows keep null duration; the player reads native media timing or packet timing through the existing protected audio endpoint when needed. No historical-media backfill or provider call runs during migration.

## Schema and migration requirement

The existing idempotent database initializer adds five columns to `submissions`: `duration_seconds`, `practice_class_id`, `practice_title`, `practice_note`, and `reviewed_at`, plus a partial practice-class/date index. `assignment_id` becomes nullable while retaining its assignment foreign key. A class foreign key and CHECK require exactly one assignment or practice class. Old assignment/submission/transcript/grade rows remain intact. Class deletion soft-deletes its practice recordings under the existing retention policy.

This uses libSQL's `ALTER COLUMN assignment_id TO assignment_id TEXT` extension. It does not rebuild/drop the submissions table or disable foreign keys. The installed engine and a legacy-schema migration test verify nullability, both foreign keys, the exclusive-context constraint, preservation of existing values and repeated initialization. Deployment will require a libSQL engine supporting this extension; it is not portable to vanilla SQLite. Nothing was run against production. [libSQL extension reference](https://github.com/tursodatabase/libsql/blob/main/libsql-sqlite3/doc/libsql_extensions.md).

## Authorization and AI allowance

Both student Open Mic API methods require the existing student identity, active class enrollment and existing domain policy. Persistence checks enrollment again inside its write transaction; revocation during storage returns 403 and cleans up the uploaded object. Student history/audio remain scoped to the student's email. Inbox, teacher audio, transcript, feedback and portfolio access follow the owning class's teacher. Another teacher/student cannot read these recordings. Transcript responses and the new lists use private/no-store caching.

Manual playback, downloads, feedback and reviewed status use no AI units. A successful practice transcript uses the existing atomic one-unit delivery/reservation mechanism. Reusing it consumes no additional unit. The existing assignment recording identity and transcript-then-grading unit reuse remain unchanged. A `practice:<classId>` logical identity supplies class context to the shared transcript identity adapter; it creates no assignment or grading record. Open Mic has no AI-grading action or score/rubric. Pricing, entitlements, quantities, billing and provider selection were not changed.

## Verification and local review

- Full suite: 119 files / 973 tests, including new upload and real-database practice workflow checks, existing transcript-then-grade credit reuse, and extended legacy migration assertions. All provider/storage failure tests use mocks or isolated local data.
- Lint, Next type generation/TypeScript, production build and `node scripts/predeploy-check.mjs --allow-dirty` passed. The release gate confirmed HEAD is current with origin/main; no rebase, commit, push or deployment occurred.
- Chromium walkthrough: microphone assignment submission, WAV assignment upload and preview, microphone Open Mic, WAV Open Mic with title/note, private history, teacher playback, exact original-audio download, mock transcript generation/copy/download, reviewed feedback and student feedback visibility after reload. The recorded WebM packet duration was about 2.2 seconds; uploaded fixtures persisted 4.125 and 6.25 seconds exactly. Normal teacher assignment review and oral portfolio were also exercised.
- Browser failure/access checks cover unsupported, oversized and broken audio; failed upload with retained preview and successful retry; the existing duplicate guard; and keyboard file selection. Mobile Open Mic, Practice Inbox and My Recordings were checked at 320 and 390 px in light/dark themes, with no horizontal overflow or uncaught browser errors. Dark-mode screenshots were also inspected after the theme transition settled.
- Review server: `http://localhost:3000`, class **Sandra workflow review**. It uses `../sandra-update-checks/review.db`, synthetic recordings, existing local auth bypass and mock AI. External database, storage, email and paid-provider credentials are cleared for this process. `.env.local` is unchanged. Scripts/logs/screenshots/download fixtures are outside the repository in `../sandra-update-checks/`.
- Local checks do not verify physical iOS/Safari microphone behavior or live cloud storage/AI services. Old recordings are measured on playback rather than backfilled. Existing 3 MB/five-minute/one-minute duplicate limits remain.

## Worktree preservation and changed files

Baseline SHA-256 hashes cover 461 tracked/untracked files. The 17 existing files changed for this update are listed below; all other baseline files remain byte-for-byte unchanged. Pre-existing added lines in the three overlapping student files remain present. Existing motion/lab artwork, global styles/layout, package changes, and all other unrelated work remain intact. No dependencies were added for this update.

Modified:

- `__tests__/audio-data-url.test.ts`
- `__tests__/submission-transcript-migration-compatibility.test.ts`
- `app/a/[assignmentId]/student-assignment-client.tsx`
- `app/api/assignments/[assignmentId]/submissions/route.ts`
- `app/api/submissions/[submissionId]/route.ts`
- `app/api/submissions/[submissionId]/transcript/route.ts`
- `app/components/AudioPlayer.tsx`
- `app/components/StudentOralPortfolio.tsx`
- `app/components/SubmissionTranscript.tsx`
- `app/student/class/[classId]/page.tsx`
- `app/student/page.tsx`
- `app/teacher/class/[classId]/page.tsx`
- `lib/audio-duration.ts`
- `lib/audio-storage.ts`
- `lib/db.ts`
- `lib/submission-errors.ts`
- `lib/validation.ts`

Added:

- `__tests__/audio-file.test.ts`
- `__tests__/practice-workflow.test.ts`
- `app/api/classes/[classId]/practice/route.ts`
- `app/api/student/classes/[classId]/practice/route.ts`
- `app/components/PracticeHistory.tsx`
- `app/student/class/[classId]/open-mic/page.tsx`
- `app/teacher/class/[classId]/practice/PracticeInbox.tsx`
- `app/teacher/class/[classId]/practice/page.tsx`
- `docs/sandra-classroom-update.md`
- `lib/audio-file.ts`
- `lib/practice-access.ts`
- `lib/store-recording.ts`
