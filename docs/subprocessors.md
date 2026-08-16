# Subprocessors

This list is based only on integrations present in the repository. Contractual terms, DPAs, regions, and provider retention must be verified manually.

| Service | Purpose | Data possibly sent | Student data possible | Required | Env/config | Evidence | Unknowns |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Google OAuth / Google Workspace | Sign-in. | Name, email, OAuth identifiers/session profile. | Student email/name when students sign in. | Required in base auth setup. | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | `auth.ts`, `app/api/auth/[...nextauth]/route.ts` | District OAuth approval, Google Workspace controls, contractual terms. |
| Microsoft OAuth / Azure AD | Optional sign-in. | Name, email, OAuth identifiers/session profile. | Student email/name if enabled. | Optional. | `AUTH_MICROSOFT_ID`, `AUTH_MICROSOFT_SECRET`, `AUTH_MICROSOFT_TENANT_ID` | `auth.ts` | Tenant restrictions, district approval, DPA. |
| Turso/libSQL | Application database. | Users, classes, assignments, submissions metadata, grades, feedback, roster, activity logs. | Yes. | Production database required. | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | `lib/db.ts` | Region, backup retention, DPA, encryption details. |
| Vercel | Hosting/serverless runtime and cron. | Requests, logs, env vars, server-rendered app data. | Possible through request metadata/logs. | Deployment provider. | Vercel project config, `vercel.json` | `next.config.ts`, `vercel.json` | Region, access controls, logs retention, DPA. |
| Vercel Blob | Student audio and assignment attachments. | Audio recordings, attachments, object paths. | Yes for audio; attachments may include educational content. | Required for production uploads. | `BLOB_READ_WRITE_TOKEN` | `lib/audio-storage.ts`, `lib/attachment-storage.ts`, audio route | Store privacy mode, deletion semantics, region, DPA. |
| Upstash Redis | Rate limiting. | Rate-limit keys: IP address or user email depending route. | Student email for submission rate limits. | Required for production rate-limited routes. | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | `lib/rate-limit.ts` | Region, retention, DPA. |
| Resend | Email notifications. | Teacher email, feedback/contact message details. | Not intended for student submissions. | Optional. | `RESEND_API_KEY` | `lib/email.ts` | Sender domain, DPA, retention. |
| Discord webhooks | Founder notifications. | Teacher upgrade email, feedback submitter details. | Not intended for student submissions. | Optional. | `DISCORD_WEBHOOK_URL` | `lib/activity.ts` | Workspace access, retention, DPA suitability. |
| OpenAI | Experimental transcription (whisper-1) and grading (gpt-4o-mini) in prototype AI grading. | Student audio, transcripts, rubric, and assignment instructions if enabled. | Yes. | Experimental and disabled by default. | `AI_GRADING_ENABLED`, `AI_TRANSCRIPTION_PROVIDER`, `AI_GRADING_PROVIDER`, `OPENAI_API_KEY` | `app/api/submissions/[submissionId]/ai-grade/route.ts`, `lib/ai/providers.ts` | Contract, data-use/training opt-out settings, retention, DPA, model choice. |
| Ollama or external model host | Alternative grading path (not the current default) that keeps transcripts off OpenAI by running grading on a self-hosted model. | Transcript, rubric, assignment instructions. | Yes if enabled via `AI_GRADING_PROVIDER=ollama`. | Optional; requires provisioning a persistent host (not usable on Vercel serverless). | `AI_GRADING_ENABLED`, `AI_GRADING_PROVIDER`, `OLLAMA_URL`, `OLLAMA_MODEL` | AI route | Host identity, region, logging, retention, access controls. |

No Google Gemini API integration was found in the repository.

