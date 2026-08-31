# Teacher Access Incident Investigation Report

**Report date:** August 31, 2026

**Incident window reviewed:** August 26–30, 2026

**Environment:** TryHabla production (`https://tryhabla.com`)

**Incident class:** Teacher onboarding and authentication availability

**Business severity:** High — acquisition-blocking, with no evidence of data loss or unauthorized access

**Status:** Historical registration outage mitigated; local product and release-safety fixes implemented and verified; production rollout pending

## Executive summary

The reported access failures were real, but they did not share one root cause.

1. **A confirmed TryHabla registration outage affected Ann on August 26.** Google accepted her school account three times, but TryHabla's production teacher-registration gate was closed while the public site advertised “Start free.” The page then presented “Teacher setup needs support” and “Use another account.” Production self-registration was enabled 17 minutes after her support message and the application was redeployed shortly afterward.

2. **Eva's August 30 failure occurred before Google OAuth began.** She reached the public TryHabla site from Facebook and submitted feedback, but production recorded no Google sign-in start, callback, or application auth error. The current Facebook-webview guard disables the sign-in control and offers a same-page `target="_blank"` link that may remain inside Facebook. This is the strongest evidence-based explanation for her report.

3. **TryHabla's Vercel URLs are not public.** Every current `*.vercel.app` deployment and alias redirects anonymous visitors to Vercel SSO, while the custom domain is public. If a Vercel URL was used in outreach, it would work for a founder signed into Vercel and fail for teachers. The exact URL used in the Facebook post was not available, so this remains conditional rather than confirmed for the reported users.

4. **The application lacks failure-stage telemetry.** Successful sign-ins are recorded, but OAuth starts, webview blocks, callback failures, registration denials, and safe error codes are not. Contact messages also omit the referring URL, browser category, and failure stage. This made a serious onboarding incident appear anecdotal until production logs and database records were manually correlated.

The production application is currently healthy, deployed from the latest `main` commit, and configured for open teacher self-registration. The remaining risk is concentrated in social-app browsers, accidentally shared noncanonical URLs, generic error handling, and insufficient observability.

## Key findings

| Finding | Confidence | Current status |
|---|---:|---|
| Ann authenticated successfully but was blocked by TryHabla's closed teacher-registration gate | Confirmed | Mitigated in production |
| Eva reached TryHabla but never initiated OAuth; Facebook webview handling is the strongest explanation | High | Fixed locally; rollout pending |
| `*.vercel.app` links are protected and unsuitable for public outreach | Confirmed configuration; conditional incident attribution | Open operational risk |
| TryHabla does not restrict authentication to selected school domains | Confirmed | Not a cause |
| Current Google OAuth initiation and callback configuration are valid | Confirmed | Healthy |
| A district Google Workspace policy can still block an otherwise valid login | Possible generally; not evidenced for Ann or Eva | Residual external risk |
| Auth and contact telemetry are insufficient to diagnose future failures quickly | Confirmed | Core diagnostics fixed locally; rollout pending |

## Incident timeline

All times below are Central Daylight Time.

### August 26 — registration-gate incident

- **2:50 PM:** Public copy was changed to advertise “Start free” and a free teacher account while production behavior remained fail-closed unless `ALLOW_TEACHER_SELF_REGISTRATION` was exactly `true` or the email was allowlisted.
- **7:04:56 PM:** A Google sign-in flow began in the production logs.
- **7:07:36 PM:** Google returned a successful OAuth callback. TryHabla then loaded the authenticated role endpoint.
- **7:07–7:11 PM:** The same teacher completed three successful Google OAuth callbacks and repeatedly reopened sign-in. No teacher-registration `POST` was recorded.
- **7:09 PM:** Ann submitted the report that her school Google account kept prompting her to try another email.
- **7:26:48 PM:** The production `ALLOW_TEACHER_SELF_REGISTRATION` value was updated to `true`.
- **Approximately 7:29 PM:** Production was redeployed with the corrected environment setting.
- **7:51 PM:** Commit `61622cf` (“Fix public teacher registration and courtesy credits”) was created.
- **Approximately 7:58 PM:** That fix was deployed to production.
- **August 27:** Ann successfully returned, created two classes, and created an assignment. Her account is currently a teacher account.

### August 30 — Facebook onboarding incident

- **3:58:17 PM:** Eva's feedback submission was accepted by production (`POST /api/feedback`, HTTP `201`).
- **3:45–4:10 PM:** Production recorded numerous unsigned registration-role checks, but no `/api/auth/signin`, `/api/auth/signin/google`, Google callback, or `/api/auth/error` traffic.
- Eva's school email has no user record in the production database.
- The supplied screenshot shows the interaction occurring inside Facebook.

### August 31 — investigation and current verification

- `https://tryhabla.com/teacher/register` returned HTTP `200` anonymously.
- `https://tryhabla.com/api/health` returned `{"status":"ok"}`.
- OAuth initiation redirected correctly to `accounts.google.com` with callback `https://tryhabla.com/api/auth/callback/google` and scopes `openid email profile`.
- Production self-registration was confirmed as `true`.
- The deployed production commit was confirmed as `85ba0f7`, matching `origin/main`.
- All current `*.vercel.app` deployment URLs and automatic aliases redirected anonymous requests to Vercel SSO.
- Twenty-seven targeted authentication and registration tests passed.

## Detailed analysis

### 1. Confirmed closed-registration failure

Production teacher registration is allowed only when the environment value is exactly lowercase `"true"`, the deployment is not production, or the email appears in the teacher allowlist. See [the teacher role route](../app/api/auth/role/route.ts).

During Ann's attempts, Google OAuth completed successfully. This rules out a rejected school domain, an invalid Google callback URL, and a Google Workspace denial for her reported flow. The failure occurred after authentication, when the application determined whether her authenticated account could become a teacher.

The registration page converted the closed state into “Teacher setup needs support,” explained that self-service was unavailable, and displayed a “Use another account” action. See [the registration page](../app/teacher/register/page.tsx). That interface closely matches Ann's description even though the school Google account itself had authenticated correctly.

This was an application and release-configuration mismatch: public acquisition copy promised open registration while the production gate remained closed.

### 2. Facebook webview trap

TryHabla classifies Facebook, Instagram, Messenger, and several other embedded browsers as unsuitable for OAuth. See [the embedded-browser detector](../lib/in-app-browser.ts).

That guard exists for a valid reason: Google does not permit OAuth authorization in disallowed embedded user agents. However, the current recovery experience is unreliable:

- The client replaces the sign-in link with a disabled element after hydration.
- The fallback labeled as opening Chrome, Edge, Firefox, or Safari is only the current URL with `target="_blank"`.
- Facebook can open that target in another Facebook webview instead of a standalone browser.
- The server also intercepts sign-in attempts from a detected webview and redirects back before NextAuth starts.
- The registration page does not provide a robust copy-link workflow or platform-specific instructions such as “Tap ⋯, then Open in browser.”

The relevant UI is in [SignInLink.tsx](../app/components/SignInLink.tsx), and the server-side guard is in [the NextAuth route](../app/api/auth/%5B...nextauth%5D/route.ts).

Eva's production evidence is consistent with this exact sequence: she reached the canonical site and could submit feedback, but no OAuth request ever began.

### 3. Protected and misleading public links

The valid public teacher-acquisition URL is:

`https://tryhabla.com/teacher/register`

Two other URL types create “works for me” failure modes:

- **Any `*.vercel.app` TryHabla URL:** Vercel project protection is configured as `all_except_custom_domains`. Anonymous visitors are redirected to Vercel SSO before TryHabla code executes. A project owner already signed into Vercel can open the same URL successfully.
- **`https://tryhabla.com/teacher`:** An authenticated teacher reaches the dashboard, while a signed-out visitor is redirected away from the protected teacher area. It is not the public registration URL.

Because deployment protection runs before the application, TryHabla cannot redirect a protected Vercel hostname to the custom domain. Public materials must use the canonical custom-domain URL.

The exact Facebook URL is required to determine whether this contributed to the reported comments.

### 4. School Google account policies

TryHabla's application code does not restrict authentication to a particular email domain. The live Google provider requests only basic identity scopes: `openid`, `email`, and `profile`. Three of the four named contacts currently have teacher accounts, including Ann, whose production events prove that her district Google account authenticated.

Google Workspace administrators can independently block unconfigured or third-party applications. That remains a possible failure mode for other districts, but the available evidence does not attribute Ann's or Eva's incident to such a policy.

References:

- [Google OAuth 2.0 policies](https://developers.google.com/identity/protocols/oauth2/policies)
- [Google Workspace third-party app access controls](https://support.google.com/a/answer/7281227)

### 5. Observability gaps

The application records successful `user_signed_in` activity but not the preceding or failed states. It currently lacks durable events for:

- auth flow started;
- embedded-browser block detected;
- provider redirect started;
- provider callback succeeded or failed;
- safe OAuth error category;
- teacher registration offered or denied;
- protected or noncanonical public hostname encountered;
- contact-message browser category, current URL, referrer category, or incident request ID.

The default Auth.js experience also collapses several unrelated failures into generic “Try signing in with a different account” messaging. Without stage-specific telemetry, users and operators cannot distinguish a district policy, cookie/state loss, database error, webview block, closed registration gate, or invalid shared URL.

## Impact and blast radius

- At least one teacher, Ann, was directly affected by the confirmed closed-registration interval.
- Eva was directly affected by a pre-OAuth access failure consistent with the Facebook webview guard.
- Additional Facebook commenters reported access failures, but unique-user impact cannot be quantified from current telemetry.
- The incident blocked acquisition and teacher onboarding; no evidence indicates student data loss, unauthorized access, or compromise.
- The service was not globally unavailable. The canonical site, health endpoint, database, and OAuth initiation were operational, and other teachers authenticated successfully.

## Current production state

- Canonical domain and registration page are public and healthy.
- Production self-registration is enabled.
- The latest `main` commit is deployed.
- Google OAuth initiation and callback configuration are correct.
- No application-level school-domain restriction is active.
- Production currently exposes Google sign-in only; Microsoft support exists in code but lacks production credentials.
- Facebook and other embedded browsers remain blocked without a dependable external-browser escape.
- Vercel deployment URLs remain protected, as intended, and must not be used for outreach.

## Recommended remediation

### P0 — immediate operational actions

1. Replace every public teacher-signup link with `https://tryhabla.com/teacher/register`.
2. Recover and verify the exact URL used in the Facebook post.
3. Edit the Facebook post to say: “Open this link in Safari or Chrome, not inside Facebook. On mobile, tap ⋯ and choose Open in browser.”
4. Respond directly to affected teachers with the canonical link and the external-browser instruction.
5. Add a pre-outreach check performed in a signed-out/private browser, not an authenticated founder browser.

### P0 — product fixes

1. Replace the misleading webview fallback with an explicit blocked-browser panel containing:
   - the full canonical URL;
   - a one-tap Copy link button;
   - iOS and Android instructions;
   - a QR code or share action where appropriate;
   - no claim that `target="_blank"` will open a particular browser.
2. Render the external-browser warning directly on `/teacher/register`, including when the server adds `auth=external-browser-required`.
3. Create a custom, stage-aware authentication error page instead of relying on Auth.js's generic account-switch message.
4. Ensure signed-out visits to `/teacher` redirect to `/teacher/register`, not an unrelated page.

### P1 — release safety

1. Normalize the runtime registration value with trimming and case normalization so release validation and runtime behavior cannot disagree.
2. Make the registration policy check mandatory in the production build or deployment pipeline.
3. Add a post-deployment synthetic check that verifies:
   - the canonical registration page is public;
   - production registration is offered to a signed-in test account;
   - the provider redirect uses the canonical callback;
   - public materials contain no Vercel deployment URL.
4. Alert when public copy advertises open registration while production registration is disabled.

### P1 — telemetry and supportability

1. Record privacy-safe auth-stage events and normalized error categories without logging tokens or sensitive OAuth payloads.
2. Record webview detection and external-browser fallback usage.
3. Attach a safe incident identifier, browser category, current route, and auth stage to contact messages.
4. Add funnel reporting for registration page viewed → sign-in started → callback completed → teacher activated.
5. Alert on sudden conversion drops between any two funnel stages.

### P2 — identity resilience and district enablement

1. Configure and verify Microsoft sign-in for Microsoft 365 districts.
2. Evaluate a non-Google fallback such as an email magic link.
3. Publish a school IT allowlisting guide containing the canonical domain, OAuth client identification, requested scopes, privacy policy, and support contact.

## Remediation implemented on August 31

The following changes are implemented on branch `fix/teacher-access-onboarding-2026-08-31` and were rebased onto current `origin/main` at final verification. They are verified locally but are **not yet deployed to production**.

- Replaced the unreliable `target="_blank"` webview fallback with explicit Facebook/in-app-browser instructions, the canonical registration URL, and an accessible copy-link workflow with Clipboard API and selection fallback.
- Added privacy-safe events for sign-in requests, embedded-browser blocks, copy-link usage, normalized Auth.js errors, sign-in rejections, and closed registration. Raw user agents, emails, query strings, OAuth payloads, and tokens are not recorded in these diagnostics.
- Added a custom sign-in error page with normalized reference codes, plain-language next steps, retry, and a support path.
- Attached safe auth context to support messages: normalized error reference, browser category, source, and pathname only. Query strings are removed and dynamic class or assignment identifiers are redacted before storage and notification.
- Changed signed-out teacher routes to redirect to `/teacher/register` while retaining the intended same-site return path in a relative `callbackUrl`.
- Distinguished a temporary registration-role check failure from an intentionally closed registration gate and added a retry action.
- Normalized `ALLOW_TEACHER_SELF_REGISTRATION` consistently across runtime role checks, AI safety checks, and release validation.
- Made the public-registration policy a mandatory build gate while retaining explicit private-deployment build and release commands.
- Corrected eager Turso initialization introduced by the latest marketing-unsubscribe changes so build-time route discovery does not require a remote database connection; runtime marketing operations still fail closed without Turso configuration.

Verification after implementation:

- Full Vitest suite: 92 files and 745 tests passed on the final integrated tree.
- All focused access-remediation, callback-safety, webview, release-policy, and feedback-migration tests passed.
- TypeScript/Next route type generation passed.
- Guarded Next.js production build passed and generated 46 of 46 current routes/pages.
- A deliberately closed public build was rejected before Next.js started; the explicit private-deployment policy path passed.
- Local HTTP checks returned `200` for teacher registration and the custom auth-error page, `302` from a simulated Facebook sign-in attempt back to the browser-required flow, and `204` from privacy-safe webview telemetry. The emitted telemetry contained only the Facebook category and `/teacher/register` pathname.
- Repository-wide ESLint passed after generated `.tmp` build artifacts were excluded from the lint scope and the newest unsubscribe page's internal links were updated for Next.js 16.
- Interactive browser click-through could not be performed because no browser connection was available in the workspace; the copy, fallback, accessibility, and telemetry behavior is covered by focused component tests.

## Acceptance criteria

Remediation should be considered complete when:

- A signed-out user can open the canonical registration URL and begin onboarding.
- A simulated Facebook user agent receives clear, usable instructions and a working copy-link path without a loop.
- No UI claims to open Chrome or Safari unless it can reliably do so.
- `/teacher` sends signed-out users to the registration experience.
- Production cannot deploy open-registration marketing with the runtime registration gate closed.
- Operators can determine the failed auth stage and safe error category from telemetry without asking the teacher for technical details.
- Public outreach is verified from a clean, unauthenticated browser before publication.

## Verification performed

- Git history and deployment correlation
- Production Vercel deployment and environment inspection
- Anonymous HTTP checks of canonical and Vercel domains
- OAuth initiation and callback-parameter inspection
- Production request-log correlation around both reports
- Read-only production user and activity lookup for the named contacts
- Targeted Vitest execution: 27 authentication, webview, and registration tests passed
- Final worktree verification against `origin/main`

## Limitations

- The exact URL pasted into the Facebook post was not available in the supplied screenshot.
- Historical contact submissions did not retain browser, referrer, route, or auth-stage metadata.
- Request-log counts may include repeated requests and should not be treated as unique visitors.
- No real school-account OAuth round trip was performed during this read-only investigation.
- District-level Google Workspace policies cannot be inspected without cooperation from the relevant district administrator.

## Conclusion

The access complaints were not vague user error. Ann encountered a confirmed TryHabla registration misconfiguration after successful Google authentication. Eva encountered a pre-OAuth failure strongly explained by TryHabla's incomplete Facebook-webview escape experience. A separately confirmed protected-link configuration can produce the same “works for me, fails for everyone else” symptom if a Vercel URL is shared.

The historical registration outage is mitigated. The local remediation branch now enforces the registration deployment invariant, repairs the Facebook external-browser handoff, adds stage-specific diagnostics, and makes support reports materially actionable. Production remains exposed to the documented residual risks until this branch is reviewed and deployed, and outreach links still require an operational canonical-URL check.
