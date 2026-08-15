# Local AI Testing

Run commands from the nested app folder that contains `package.json`:

```powershell
cd C:\Users\david\Downloads\Speaklab-main\Speaklab-main
```

## First Setup

```powershell
copy .env.local.example .env.local
npm.cmd install
npm.cmd run ai:doctor
npm.cmd run ai:seed
npm.cmd run dev:local
```

Then open:

```text
http://localhost:3000/teacher
```

`dev:local` always targets port `3000`. If Habla is already running, it prints the existing URLs instead of starting a second server. If another process owns `3000`, it prints the PID and stops.

## Mock Mode

The default local template uses:

```env
AI_GRADING_ENABLED=true
AI_TRANSCRIPTION_PROVIDER=mock
AI_GRADING_PROVIDER=mock
LOCAL_DEV_BYPASS_AUTH=true
```

Mock mode never contacts OpenAI, Ollama, Vercel Blob, Upstash Redis, OAuth, Resend, or Discord. It uses synthetic transcript and grading data.

## Testing Success

1. Run `npm.cmd run ai:seed`.
2. Run `npm.cmd run dev:local`.
3. Open `http://localhost:3000/teacher`.
4. Open `Local AI Test Class`.
5. Select `Local AI Speaking Test`.
6. Click `Generate AI suggestion`.
7. Confirm a panel appears with `Local AI test mode` and `Mock suggestion`.
8. Click `Use suggestion`.
9. Confirm draft score, rubric fields, and feedback are filled.
10. Refresh before pressing `Save grade`; the final grade should still be empty.
11. Press `Save grade` only when you want to finalize manually.

## Failure Modes

Set one of these in `.env.local`, then restart the dev server:

```env
AI_LOCAL_FAILURE_MODE=transcription_failure
AI_LOCAL_FAILURE_MODE=grading_failure
AI_LOCAL_FAILURE_MODE=malformed_provider_output
AI_LOCAL_FAILURE_MODE=low_quality_transcript
AI_LOCAL_FAILURE_MODE=target_language_mismatch
AI_LOCAL_FAILURE_MODE=unable_to_grade
AI_LOCAL_FAILURE_MODE=provider_timeout
```

Clear it with:

```env
AI_LOCAL_FAILURE_MODE=
```

To test disabled state:

```env
AI_GRADING_ENABLED=false
```

The button should disappear and the API should return `404`.

To test rate limits, lower:

```env
AI_GENERATION_COOLDOWN_SECONDS=60
AI_MAX_GENERATIONS_PER_SUBMISSION=1
```

## Commands

```powershell
npm.cmd run dev:local
npm.cmd run dev:status
npm.cmd run dev:stop
npm.cmd run ai:doctor
npm.cmd run ai:seed
npm.cmd run ai:smoke
npm.cmd run ai:reset
```

`ai:reset` deletes only records with the local fixture IDs:

- `local_ai_class`
- `local_ai_assignment`
- `local_ai_submission`
- related `ai_grading_attempts`

It refuses to run without `LOCAL_DEV_BYPASS_AUTH=true`.

## Real Providers Later

For real local provider testing, keep production data out of the environment and switch providers explicitly:

```env
AI_TRANSCRIPTION_PROVIDER=openai
AI_GRADING_PROVIDER=ollama
OPENAI_API_KEY=configured-locally-only
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

Do not use production student data or production credentials for local testing.

## Common Errors

- `Could not read package.json`: you are one folder too high. Run `cd C:\Users\david\Downloads\Speaklab-main\Speaklab-main`.
- `.next/dev/lock`: run `npm.cmd run dev:status`. If Habla is already running, open the printed URL. If stale, `dev:local` removes it only when no Habla process owns it.
- `ERR_CONNECTION_REFUSED` on `3001`: use `http://localhost:3000`. Habla local scripts do not silently move to `3001`.
- AI button missing: confirm `AI_GRADING_ENABLED=true`, restart dev server, and check `/api/features`.
- Provider configuration error: use mock providers or configure the selected real provider.
