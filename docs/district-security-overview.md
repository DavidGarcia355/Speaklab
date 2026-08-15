# District Security Overview

This overview is for preliminary school technology review. It reflects source-code behavior only and does not verify the live production environment.

## Product Purpose

Habla helps language teachers create speaking assignments, collect student audio recordings, review submissions, enter grades/feedback, manage rosters, and export CSV gradebooks.

## Users And Roles

- Teachers create classes/assignments and review submissions for classes they own.
- Students sign in and submit recordings through assignment links.
- One configured founder/admin email can view internal analytics and support messages.

## Authentication

Habla uses NextAuth with Google OAuth in the base setup. Microsoft/Azure AD OAuth is optional when configured. Teacher routes require a `teacher` role. Production teacher self-registration is closed unless `ALLOW_TEACHER_SELF_REGISTRATION=true`, the user is already a teacher, or the email is in `TEACHER_ALLOWLIST`.

## Data Collected

See `docs/data-inventory.md`. Main categories include teacher/student emails, student-entered names, class/assignment content, roster rows, student audio recordings, submission timestamps, grades, rubric scores, written feedback, support messages, activity logs, cookies/session data, and rate-limit keys.

## Student Audio Handling

Student audio uploads use Vercel Blob with `access: "private"`. The app no longer falls back to public Blob storage. Teacher playback goes through `/api/submissions/[submissionId]/audio`, which checks teacher role and class ownership before streaming audio. Existing public Blob URLs are blocked and require migration before playback.

## Authorization Controls

Class, assignment, submission, roster, gradebook, and audio APIs check teacher identity and class ownership. Student submission requires sign-in. Optional controls can restrict submissions by email domain and require roster membership.

## Retention And Deletion

Classes, assignments, and submissions use soft delete first. Cleanup cron hard-deletes records older than 30 days and deletes associated student audio and unreferenced assignment attachments. Activity logs, users, support messages, and account deletion need policy decisions.

## Storage And Subprocessors

Database: Turso/libSQL. Hosting: Vercel. File storage: Vercel Blob. Rate limiting: Upstash Redis. Optional email/webhooks: Resend and Discord. Auth: Google OAuth and optional Microsoft OAuth. Experimental AI providers are OpenAI and Ollama/external model host, but AI grading is disabled by default.

## Experimental Features

AI grading is experimental and disabled unless `AI_GRADING_ENABLED=true`. When disabled, the UI is hidden and the API returns unavailable before fetching audio or calling providers.

## District Configuration Options

- `TEACHER_ALLOWLIST`
- `ALLOW_TEACHER_SELF_REGISTRATION`
- `ENFORCE_STUDENT_DOMAIN`
- `STUDENT_DOMAIN`
- `REQUIRE_ROSTER_FOR_SUBMISSIONS`
- OAuth provider configuration
- `AI_GRADING_ENABLED=false`

## Items Requiring Deployment Verification

- Live environment variables.
- Actual Blob privacy mode.
- Production database region.
- Provider contracts and DPAs.
- Provider backup retention.
- Encryption-at-rest details from providers.
- Production access permissions.
- Domain configuration.
- Live account data.
- Incident-response contact information.
- District data-request contact information.
- Whether production cron is configured and succeeding.

