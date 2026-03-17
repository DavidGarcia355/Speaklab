# Habla Audit

## 1.1 What works end-to-end right now

- Public landing page at `/` explains the product, links to FAQ/feedback, and starts Google sign-in for teachers.
- Google OAuth sign-in works through NextAuth, creates a user record on first sign-in, and stores a `student` or `teacher` role in the `users` table.
- A signed-in student can see an in-app teacher upgrade prompt and self-upgrade to teacher at `/teacher/register` with one click.
- A teacher can open `/teacher`, load their classes, and see assignment/submission counts plus grading status.
- A teacher can create a class, get redirected into that class workspace, and then create an assignment from there.
- A teacher can create an assignment, open the student-facing assignment page, and copy the student link from the class workspace.
- A student with the assignment link can load the assignment details, sign in with Google, record audio in-browser, review playback, and submit the recording.
- Submission uploads persist the audio to Vercel Blob, save submission metadata in the database, and rate-limit repeat submissions.
- A teacher can open a class, see assignments and submissions, play back student audio, enter grades, add feedback, and save changes inline.
- A teacher can rename a student submission, delete a submission, delete an assignment, and delete a class, with short undo windows in the UI before the server delete commits.
- A teacher can export a class gradebook as CSV from `/api/classes/[classId]/gradebook.csv`.
- Audio playback for teachers works through the protected `/api/submissions/[submissionId]/audio` proxy route rather than exposing raw blob contents directly in the app.
- Public FAQ and feedback/contact flows work; the feedback form validates input, rate-limits requests, and writes rows to `feedback_messages`.
- The health check route `/api/health` responds after successfully touching the DB.
- Daily cleanup is implemented through `/api/cron/cleanup`, which hard-deletes soft-deleted classes, assignments, and submissions older than 30 days.

## 1.2 What is broken or incomplete

- `README.md` is slightly out of date: it still says `npm run check` runs lint, typecheck, and build, but the script now also runs tests.
- `proxy.ts` only checks whether a user is authenticated, not whether they are a teacher. Teacher-only API routes do enforce the role, but the `/teacher` page shell itself relies on client-side handling instead of server-side role gating.
- `app/a/[assignmentId]/page.tsx` still uses hostname-based local bypass UI (`localhost` / `127.0.0.1`) rather than the hardened `LOCAL_DEV_BYPASS_AUTH` env flag, so local recorder controls can appear even when server-side bypass is off.
- `lib/store.ts` is legacy localStorage-based storage that is no longer wired into the app. It is dead code and can confuse future contributors.

## 1.3 What is missing entirely

- There is no internal admin UI for viewing or triaging rows in `feedback_messages`.
- There is no admin/user-management UI for promoting or demoting users beyond the self-upgrade flow and the `TEACHER_ALLOWLIST` env var.
- There is no billing or subscription system yet: no customer table, no plan model, no Stripe webhook route, and no billing portal/customer-management UI.
- There is no teacher-facing analytics or usage reporting UI (for example: total recordings this week, active classes, or submission completion rate).
- There is no email notification system for new feedback, new submissions, or onboarding.

## 1.4 Current DB schema summary

- `classes`: `id`, `name`, `owner_email`, `created_at`, `deleted_at`; stores teacher-owned class containers.
- `assignments`: `id`, `class_id`, `title`, `description`, `instructions`, `created_at`, `deleted_at`; stores speaking prompts under a class.
- `submissions`: `id`, `assignment_id`, `student_name`, `student_email`, `audio_data`, `audio_blob_url`, `submitted_at`, `feedback`, `grade`, `deleted_at`; stores student recordings and grading data.
- `feedback_messages`: `id`, `name`, `email`, `school`, `role`, `message`, `created_at`; stores public feedback/contact form submissions.
- `users`: `email`, `role`, `created_at`; stores app roles for Google-authenticated users.

## 1.5 Current API routes

- `GET /api/health`: verifies the DB is reachable and returns `{ status: "ok", timestamp }`.
- `POST /api/feedback`: validates and stores a public feedback/contact submission.
- `GET /api/cron/cleanup`: deletes soft-deleted data older than 30 days when called with the cron secret.
- `GET /api/auth/[...nextauth]`: handles NextAuth OAuth/session actions and rate-limits sign-in attempts.
- `POST /api/auth/[...nextauth]`: handles NextAuth OAuth/session actions and rate-limits sign-in attempts.
- `GET /api/auth/role`: returns the authenticated user email and current role.
- `POST /api/auth/role`: promotes the authenticated user to `teacher`.
- `GET /api/classes`: returns all non-deleted classes owned by the authenticated teacher.
- `POST /api/classes`: creates a new class for the authenticated teacher.
- `GET /api/classes/[classId]`: returns a teacher-owned class plus its assignments, submissions, and summary stats.
- `PATCH /api/classes/[classId]`: renames a teacher-owned class.
- `DELETE /api/classes/[classId]`: soft-deletes a teacher-owned class and its related data.
- `POST /api/classes/[classId]/assignments`: creates a new assignment inside a teacher-owned class.
- `GET /api/classes/[classId]/gradebook.csv`: exports teacher-owned submission data as CSV.
- `GET /api/assignments/[assignmentId]`: returns assignment details for a teacher-owned assignment.
- `PATCH /api/assignments/[assignmentId]`: updates assignment title and instructions for a teacher-owned assignment.
- `DELETE /api/assignments/[assignmentId]`: soft-deletes a teacher-owned assignment and its submissions.
- `POST /api/assignments/[assignmentId]/submissions`: accepts a student audio submission for a public assignment link.
- `GET /api/student/assignments/[assignmentId]`: returns assignment details for the student-facing assignment page.
- `PATCH /api/submissions/[submissionId]`: updates student name, grade, and/or feedback for a teacher-owned submission.
- `DELETE /api/submissions/[submissionId]`: soft-deletes a teacher-owned submission.
- `GET /api/submissions/[submissionId]/audio`: streams the stored audio for a teacher-owned submission.

## 1.6 Current environment variables

- `AUTH_GOOGLE_ID`: Google OAuth client ID. No in-app default.
- `AUTH_GOOGLE_SECRET`: Google OAuth client secret. No in-app default.
- `AUTH_SECRET`: NextAuth signing secret. No in-app default.
- `TURSO_DATABASE_URL`: Turso/libsql DB URL. Optional in local dev if paired `TURSO_AUTH_TOKEN` is also absent; required in production.
- `TURSO_AUTH_TOKEN`: Turso auth token. Optional in local dev if paired `TURSO_DATABASE_URL` is also absent; required in production when using Turso.
- `UPSTASH_REDIS_REST_URL`: Upstash Redis REST URL for rate limiting. No in-app default.
- `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis REST token for rate limiting. No in-app default.
- `BLOB_READ_WRITE_TOKEN`: Vercel Blob token used for server uploads and private reads. No in-app default.
- `CRON_SECRET`: shared secret for the cleanup route. No in-app default.
- `NEXTAUTH_URL`: primary production origin used by auth and CORS checks. Falls back to `VERCEL_PROJECT_PRODUCTION_URL` or local dev origin.
- `VERCEL_PROJECT_PRODUCTION_URL`: optional Vercel-provided production hostname used to derive the production origin when `NEXTAUTH_URL` is unset.
- `LOCAL_DEV_BYPASS_AUTH`: opt-in local-development bypass for auth (`"true"` enables it). Defaults to disabled when unset.
- `TEACHER_ALLOWLIST`: comma-separated list of emails that should become `teacher` on first Google sign-in. Defaults to empty.
- `ENFORCE_STUDENT_DOMAIN`: when `"true"`, student submissions are restricted to a configured domain. Defaults to disabled when unset.
- `STUDENT_DOMAIN`: optional domain used for student submission restriction. When unset, the teacher email domain is used if enforcement is on.
- `NODE_ENV`: framework/runtime env used to distinguish development vs production behavior. Managed by the platform/tooling, not by app code.

## Launch readiness

### Ship it now

- Google sign-in, teacher self-upgrade, class creation, assignment creation, student recording, teacher playback, grading, and CSV export all work together.
- Public homepage, FAQ, and feedback/contact page are present and usable.
- Audio access is now protected through a teacher-only proxy path with private blobs behind it.
- The repo has automated coverage for authz and submission-domain behavior, and `npm run check` passes.

### Fix before sharing the Facebook post

- Tighten middleware role gating for `/teacher` so non-teacher users do not rely on client-side upgrade handling after the page shell loads.
- Align the student-page local bypass UI with the hardened server-side bypass flag so local dev does not produce misleading behavior.
- Decide whether the remaining “pilot” language in FAQ/contact copy is still accurate for the public rollout and normalize it if not.
- Consider removing or isolating `lib/store.ts` so contributors do not mistake the old localStorage path for the live data model.

### Nice to have before Stripe

- Internal feedback inbox or admin page to review `feedback_messages`.
- A lightweight teacher settings/profile page with sign-out, account info, and help links.
- Better first-run analytics inside the teacher dashboard, such as class activity and pending grading summaries over time.
- More tests around the main teacher workspace and audio playback path.

### Stripe readiness

- Add a `subscriptions` table keyed to teacher email or a durable user ID with plan name, status, renewal date, Stripe customer ID, Stripe subscription ID, and trial metadata.
- Add a `customers`/billing profile table or expand `users` to hold Stripe customer IDs and billing state.
- Add webhook routes for Stripe events such as `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
- Add authenticated API routes and UI for checkout session creation, billing portal session creation, and plan/status retrieval.
- Add server-side authorization checks that gate premium-only features based on active subscription state.
