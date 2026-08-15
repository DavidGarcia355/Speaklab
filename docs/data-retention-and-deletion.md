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
| AI prototype data | No persistent AI result table currently exists. | Not applicable. | AI grading is disabled by default. |

## Cleanup Behavior

`vercel.json` schedules `/api/cron/cleanup` daily at 02:00 UTC. The route requires `CRON_SECRET` through `Authorization: Bearer ...` or `x-cron-secret`.

The cleanup response reports counts only: deleted records and attempted/deleted/failed/skipped Blob objects. It must not include student names, emails, grades, feedback, transcripts, or audio content.

## Unknowns Requiring Deployment Or Provider Verification

- Vercel Blob store privacy mode and provider deletion semantics.
- Turso and Vercel backup retention.
- Provider regions.
- Whether production cron is enabled and receiving `CRON_SECRET`.
- Account closure and district termination workflow.
- Export format required by a district beyond current CSV gradebook export.

