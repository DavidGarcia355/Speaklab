# Habla

Habla is a Next.js app for language teachers to run speaking assignments:
- create classes
- publish student recording links
- review submissions with inline grades and feedback
- export CSV gradebooks for PowerSchool import

## Requirements

- Node.js 20+
- npm 10+

## Local Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

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

7. Redeploy:

```bash
vercel
```

## Production Build

```bash
npm run check
npm run start
```

`npm run check` runs lint, typecheck, and build.

## Health Check

Use:

```bash
GET /api/health
```

Expected response:

```json
{ "status": "ok", "timestamp": "..." }
```

## Production Checklist

### Required Environment Variables

Set all values below in Vercel project settings (or `.env.local` for local testing):

```bash
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
AUTH_SECRET=...
SCHOOL_GOOGLE_DOMAIN=myschool.org
TEACHER_EMAILS=teacher1@myschool.org,teacher2@myschool.org
TURSO_DATABASE_URL=...
TURSO_AUTH_TOKEN=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
BLOB_READ_WRITE_TOKEN=...
CRON_SECRET=...
NEXTAUTH_URL=https://your-app.vercel.app
```

Notes:
- `SCHOOL_GOOGLE_DOMAIN` must be a domain only (`myschool.org`), not `@myschool.org`.
- `TEACHER_EMAILS` is comma-separated; spaces are optional.
- If required vars are missing, APIs fail closed and return server configuration errors.
- If you see `Server misconfiguration` in the deployed app, at least one required env is missing in Vercel.

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
   - Auth sign-in: 10/hour per IP
   - Gradebook export: 10/hour per teacher email

### Storage Setup

1. Create Vercel Blob store for submission audio.
2. Add `BLOB_READ_WRITE_TOKEN` to Vercel env vars.
3. Audio retrieval is authorized through protected API routes.

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
