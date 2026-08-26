# TryHabla

TryHabla is a Next.js app for language teachers to run speaking assignments:
- create classes
- publish student recording links
- review submissions with inline grades and feedback
- export CSV gradebooks for PowerSchool import
- collect pilot feedback from public school teachers

## Requirements

- Node.js 20+
- npm 10+

## Local Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

For repeatable local AI-grading testing on Windows, use:

```powershell
copy .env.local.example .env.local
npm.cmd run ai:doctor
npm.cmd run ai:seed
npm.cmd run dev:local
```

See `docs/local-ai-testing.md`.

## Quick Full Setup (Local + Vercel)

1. Copy env template:

```bash
copy .env.example .env.local
```

2. Generate secure secrets:

```bash
node scripts/gen-secrets.mjs
```

3. Paste generated `AUTH_SECRET` and `CRON_SECRET` into `.env.local`.
4. Fill all remaining required values in `.env.local`.
5. Log in and link project:

```bash
vercel login
vercel
```

6. Push envs to Vercel preview (and optionally production):

```bash
powershell -ExecutionPolicy Bypass -File scripts/sync-vercel-env.ps1 -EnvFile .env.local -Targets preview,production
```

The sync script manages `TEACHER_ALLOWLIST` and
`ALLOW_TEACHER_SELF_REGISTRATION`. When either is omitted or blank, it clears
the corresponding Vercel value; production teacher self-registration therefore
stays closed unless you deliberately set the gate to `true`.

7. Redeploy:

```bash
vercel
```

## Production Build

```bash
npm run check
npm run start
```

`npm run check` runs lint, the full automated test suite, typecheck, and a production build.

## Health Check

Use:

```bash
GET /api/health
```

Expected response:

```json
{ "status": "ok", "timestamp": "..." }
```

## Public Pages

- `/` Home
- `/faq` Teacher FAQ
- `/feedback` Pilot request and feedback form (writes to `feedback_messages` table)
- `/unauthorized` Friendly access message page

## Production Checklist

### Required Environment Variables

Set production values in Vercel project settings and local values in `.env.local`.
See `docs/environment-variables.md` for the full grouped inventory, optional integrations,
and behavior when a value is absent.

```bash
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
AUTH_SECRET=...
TURSO_DATABASE_URL=...
TURSO_AUTH_TOKEN=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
AUDIO_BLOB_STORE_ID=...
CRON_SECRET=...
NEXTAUTH_URL=https://your-app.vercel.app
```

Notes:
- If required vars are missing, APIs fail closed and return server configuration errors.
- `AUDIO_BLOB_STORE_ID` selects the private Vercel Blob store used at runtime. Vercel
  deployments authenticate to it with the project's short-lived OIDC identity, so do not add
  `AUDIO_READ_WRITE_TOKEN` to Vercel.
- `BLOB_READ_WRITE_TOKEN` is not a runtime setting. It is only for inventorying and deleting
  objects in the legacy public store during the one-time media migration.

### Google OAuth Setup

1. In Google Cloud Console, create OAuth credentials (Web application).
2. Add authorized redirect URI:
   - Local: `http://127.0.0.1:3000/api/auth/callback/google`
   - Production: `https://your-app.vercel.app/api/auth/callback/google`
3. Copy client ID/secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.
4. Generate `AUTH_SECRET` with a long random value (at least 32 bytes).

### Turso Setup

1. Create a Turso database and auth token from Turso dashboard.
2. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in Vercel.
3. Keep these values server-only.
4. Local development fallback:
   - If both Turso vars are unset, the app uses local libsql file mode at `data/local.db`.
   - If one is set without the other, startup fails.

### Upstash Redis Setup

1. Create a free Redis database in Upstash.
2. Copy REST URL/token into:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
3. Rate limits enforced:
   - Submission API: 5/hour per student email
   - Auth sign-in: 100/hour per IP
   - Gradebook export: 10/hour per teacher email

### Storage Setup

1. Create or select a private Vercel Blob store for submission audio and assignment attachments.
2. Connect that store to the Vercel project so deployed functions can use project OIDC, then add
   its store ID as `AUDIO_BLOB_STORE_ID` in each deployed environment.
3. Do not add a static `AUDIO_READ_WRITE_TOKEN` to Vercel. Use one only in the local/off-Vercel
   process that performs the one-time legacy-media migration, then revoke or remove it.
4. Keep `BLOB_READ_WRITE_TOKEN` out of normal runtime environments. It authorizes the legacy
   public store and is needed only by the migration's inventory and cleanup steps.
5. Audio and worksheet retrieval is authorized through protected API routes. The app fails safely
   instead of falling back to public storage for new student media.

### Private Media Release And Migration

Do not promote the release until this sequence is complete. Run deployment and migration as one
controlled maintenance operation so the compatibility window is short:

1. Build from a clean branch based on current `origin/main`, run `npm run release:check`, and retain
   the successful result.
2. Configure the production private store connection and `AUDIO_BLOB_STORE_ID`; leave
   `AUDIO_READ_WRITE_TOKEN` and `BLOB_READ_WRITE_TOKEN` out of the Vercel runtime.
3. From a secured local/off-Vercel operator environment, provide read-only Turso credentials, the
   legacy `BLOB_READ_WRITE_TOKEN`, `AUDIO_BLOB_STORE_ID`, and a short-lived
   `AUDIO_READ_WRITE_TOKEN`. Run the migration with no flags. The default is a read-only dry run;
   it inventories the legacy store and byte-validates both migration sources and existing private
   database references:

   ```bash
   node scripts/migrate-public-audio-to-private.mjs
   ```

4. Review the dry-run totals and blockers. Separately verify (a) a current, restorable production
   database backup and (b) a recoverable backup/export of both legacy Blob prefixes,
   `submissions/` and `assignment-attachments/`. Obtain explicit release-owner signoff. A database
   backup cannot restore unreferenced legacy objects removed by the final sweep.
5. Deploy the compatibility/private-media code first and verify health/auth guards. Do not promote
   while legacy objects remain public.
6. In the same secured operator environment, run:

   ```bash
   node scripts/migrate-public-audio-to-private.mjs --apply --backup-confirmed --legacy-media-backup-confirmed
   ```

7. Run the default dry run again. Treat any remaining legacy database reference, pending cleanup,
   or in-scope public object as a launch blocker.
8. Revoke/remove the temporary private token and legacy public-store token. Confirm neither static
   token remains in Vercel, then complete an authenticated recording -> playback -> grading smoke
   test before promotion.

`--backup-confirmed` asserts that the database backup is restorable;
`--legacy-media-backup-confirmed` separately asserts that both legacy Blob prefixes have a
recoverable backup/export. Neither flag creates or tests its backup. The operator remains
responsible for confirming both and obtaining signoff before `--apply`.

### District Review And Privacy Docs

Preliminary review materials live in `docs/`:

- `docs/data-inventory.md`
- `docs/subprocessors.md`
- `docs/data-retention-and-deletion.md`
- `docs/district-security-overview.md`
- `docs/legal/privacy-policy-draft.md`
- `docs/legal/school-dpa-template-draft.md`
- `docs/legal/district-security-questionnaire-template.md`
- `docs/compliance-gap-register.md`

Legal drafts are not legal advice and must be reviewed by qualified counsel before use.

### Experimental AI

The unfinished AI-grading prototype is disabled by default with:

```bash
AI_GRADING_ENABLED=false
```

Do not enable AI grading for student data until privacy, provider, cost, retention, testing,
and district-review requirements have been completed.

### Cron Cleanup

`vercel.json` schedules daily cleanup at 2:00 UTC:
- Path: `/api/cron/cleanup`
- Auth: requires `CRON_SECRET` in `Authorization: Bearer ...` or `x-cron-secret`
- Behavior: hard-deletes records soft-deleted more than 30 days ago

### Secret Rotation

If `AUTH_SECRET` is compromised:
1. Generate a new value.
2. Update `AUTH_SECRET` in Vercel.
3. Redeploy.
4. Expect existing sessions to be invalidated; users must sign in again.

## Launch Smoke Test

Run after every production deploy:

1. Home page loads at `https://tryhabla.com`.
2. `/faq` renders and links to `/feedback`.
3. `/feedback` submits a valid form and returns success message.
4. Google sign-in from teacher entry points lands on `/teacher`.
5. Unauthenticated users are redirected to sign in for teacher APIs/pages.
6. Student assignment link requires Google sign-in before submission.
7. Student can record, submit, and teacher can play back audio.
8. Grade save + CSV export still work.
9. `GET /api/health` returns `200` and `status: ok`.

## Contact Links

Public contact buttons are in `app/constants.ts`:

```ts
export const CONTACT_LINKS = {
  linkedin: "...",
  email: "...",
  github: "...",
  phone: "...",
};
```
