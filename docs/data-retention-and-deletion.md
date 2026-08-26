# Data Retention And Deletion

This document describes implemented behavior in the repository. It is not legal advice and does not verify provider backups or production settings.

## Implemented Timelines

| Data | Active retention | Soft delete | Hard delete |
| --- | --- | --- | --- |
| Classes | Retained while teacher keeps the class. | Teacher delete sets `classes.deleted_at`; assignments and submissions are soft-deleted with it. | `/api/cron/cleanup` deletes soft-deleted records older than 30 days. |
| Assignments | Retained while class/assignment is active. | Teacher delete sets `assignments.deleted_at`; submissions are soft-deleted with it. | Deleted after 30 days by cleanup cron. |
| Submissions, grades, feedback, rubric scores | Retained while submission is active. | Teacher/student delete sets `submissions.deleted_at` where authorized. | Deleted after 30 days by cleanup cron. |
| Student audio files | Retained in Vercel Blob while submission is active. | Not deleted during undo/soft-delete period. | Cleanup deletes associated Blob objects when submission records are hard-deleted. |
| Assignment attachments | Retained while referenced by active assignments. | Not deleted during undo/soft-delete period. | Cleanup deletes attachment objects only when no active or not-yet-expired assignment references the same URL. |
| Feedback/contact messages | Retained until admin deletion. | No soft-delete. | Admin delete removes the DB row. |
| Activity logs | Retained indefinitely in `activity_events`. | No soft-delete. | No automated deletion currently implemented. |
| User accounts | Retained indefinitely in `users`. | Account deletion is not currently supported. | Decision required. |
| AI transcripts | A teacher-requested transcript and its provider/model, duration, cost-estimate, and latency metadata are retained in `submission_transcripts` while the related submission exists. | Follows the related submission's soft-delete period. | Cascades when the submission is hard-deleted after 30 days; no shorter transcript-specific TTL currently exists. |
| AI grading attempts | Suggestions, transcript copy, evidence, provider/model metadata, and safe error classification are retained in `ai_grading_attempts` while the related submission exists. | Follows the related submission's soft-delete period. | Cascades when the submission is hard-deleted after 30 days; no shorter AI-specific TTL currently exists. |
| Google Drive export authorization | A short-lived Google access token is held only in browser memory during a teacher-initiated export. TryHabla does not store a Google Drive refresh token. | Not applicable. | The browser-memory token disappears when the flow ends, the page closes, or the token expires. |
| Copies exported to Google Drive | Controlled by the teacher or school's Google Drive account and its policies, independently of TryHabla. | TryHabla has no soft-delete control over the exported copy. | Remains until an authorized Google Drive user deletes it. Deleting the source from TryHabla does not delete the Drive copy. |

## Cleanup Behavior

`vercel.json` schedules `/api/cron/cleanup` daily at 02:00 UTC. The route requires `CRON_SECRET` through `Authorization: Bearer ...` or `x-cron-secret`.

The cleanup response reports counts only: deleted records and attempted/deleted/failed/skipped Blob objects. It must not include student names, emails, grades, feedback, transcripts, or audio content.

TryHabla does not promise permanent storage. Google Drive export is a user-directed copy operation,
not an extension of TryHabla retention, recovery, or deletion.

## Unknowns Requiring Deployment Or Provider Verification

- Vercel Blob store privacy mode and provider deletion semantics.
- Turso and Vercel backup retention.
- Provider regions.
- Whether production cron is enabled and receiving `CRON_SECRET`.
- Account closure and district termination workflow.
- Export format required by a district beyond current CSV gradebook export.

