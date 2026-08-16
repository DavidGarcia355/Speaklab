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

Chosen path: OpenAI for both transcription and grading (no self-hosted infra to run).
For real local provider testing, keep production data out of the environment and switch providers explicitly:

```env
AI_TRANSCRIPTION_PROVIDER=openai
AI_GRADING_PROVIDER=openai
AI_TRANSCRIPTION_MODEL=whisper-1
AI_GRADING_MODEL=gpt-4o-mini
OPENAI_API_KEY=configured-locally-only
```

Do not use production student data or production credentials for local testing.

### Granting a teacher access

AI grading is gated behind `getUserIsPaid`, which reads the `users.is_paid` column — there is
no self-serve billing yet, so this must be granted manually. Sign in as the account matching
`ADMIN_EMAIL`, open `/admin`, find the teacher in the **Teacher roster** table, and click the
pill in the **AI grading** column to toggle **Free ⇄ Paid**. This calls
`PATCH /api/admin/teachers/[email]/paid`, which is itself gated by `requireAdminEmail`.

### Getting an API key

1. Create/sign in to an OpenAI account: https://platform.openai.com/signup
2. Add a payment method: https://platform.openai.com/settings/organization/billing/overview
3. Create a key: https://platform.openai.com/api-keys
4. Paste it into `OPENAI_API_KEY` in `.env.local` (never commit it).

New accounts get $5 in free credit, which covers roughly 800+ AI-grade generations before any
charge lands.

### Cost per AI-grade generation

Each click of "Generate AI suggestion" does one transcription call and one grading call
(nothing is cached, so regenerating re-runs both). Assuming a ~2-minute student recording:

| Step | Model | Rate | Cost for 2 min / ~600 in / ~400 out tokens |
| --- | --- | --- | --- |
| Transcription | `whisper-1` | $0.006/min | ~$0.012 |
| Grading | `gpt-4o-mini` | $0.15/1M in, $0.60/1M out | ~$0.0003 |
| **Total** | | | **~$0.012/generation (~1 cent)** |

`AI_MAX_GENERATIONS_PER_SUBMISSION` caps regeneration at 10, so worst case per submission is
~$0.12. At scale: 1,000 generations/month ≈ $12; 10,000/month ≈ $120. No fixed/infra cost —
pure pay-as-you-go, billed by the second, no volume commitment.

To cut transcription cost roughly in half, switch `AI_TRANSCRIPTION_MODEL` to
`gpt-4o-mini-transcribe` ($0.003/min) — same API shape, drop-in env change.

### Cost-runaway guardrails

Layered protections, in the order a request hits them:

1. **Paid-plan gate** — `AI_GRADING_ENABLED` route requires `getUserIsPaid`; only paying teachers can trigger real spend at all.
2. **Cooldown** — `AI_GENERATION_COOLDOWN_SECONDS` (default 3s) blocks rapid re-clicks.
3. **Per-submission cap** — `AI_MAX_GENERATIONS_PER_SUBMISSION` (default 10) bounds regeneration on one recording.
4. **Per-teacher daily cap** — `AI_DAILY_TEACHER_LIMIT` (default 100/day).
5. **App-wide daily cap** — `AI_DAILY_GLOBAL_LIMIT` (default 500/day) bounds total spend across every teacher combined,
   independent of how many paid accounts exist. Size it to your budget: generations × ~$0.012 ≈ daily $ exposure
   (500/day ≈ $6/day ≈ $180/month worst case at normal per-call cost).
6. **Audio-duration circuit breaker** — the transcription call now requests `verbose_json` from OpenAI and reads back
   the real audio duration. If it exceeds `AI_MAX_AUDIO_SECONDS`, the attempt is recorded as failed
   (`errorCode: "audio_too_long"`) and returns `413` instead of proceeding to grading. A submission that's already
   failed this way is rejected immediately on the next attempt (`hasAudioTooLongFailure`), so a single oversized or
   low-bitrate file can only be transcribed once, not up to 10 times.

None of these are a substitute for an OpenAI-side hard spend limit — they reduce app-level risk, but only the
provider's own billing cap is a guaranteed ceiling that survives an app bug. Set that too:
1. https://platform.openai.com/settings/organization/limits
2. Edit spend limit → enter a monthly cap → enable "Enforce a hard limit" → Save.

### Alternative: self-hosted Ollama for grading

`AI_GRADING_PROVIDER=ollama` keeps transcript text off OpenAI (only audio still goes out for
transcription). It requires a persistent host running Ollama — Vercel serverless functions
cannot host it. A small VPS (e.g. Hetzner CPX31, ~$18-27/mo, or a DigitalOcean equivalent)
running `llama3.2` works. This is a flat monthly cost regardless of usage/volume, plus ongoing
maintenance, and does not reduce cost versus OpenAI grading (gpt-4o-mini grading is already
near-free) — its only benefit is not sending transcript text to a third party.

## Common Errors

- `Could not read package.json`: you are one folder too high. Run `cd C:\Users\david\Downloads\Speaklab-main\Speaklab-main`.
- `.next/dev/lock`: run `npm.cmd run dev:status`. If Habla is already running, open the printed URL. If stale, `dev:local` removes it only when no Habla process owns it.
- `ERR_CONNECTION_REFUSED` on `3001`: use `http://localhost:3000`. Habla local scripts do not silently move to `3001`.
- AI button missing: confirm `AI_GRADING_ENABLED=true`, restart dev server, and check `/api/features`.
- Provider configuration error: use mock providers or configure the selected real provider.
