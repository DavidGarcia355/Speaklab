# Compliance Gap Register

| ID | Area | Requirement or concern | Current state | Evidence | Risk level | Remediation | Owner | Target date | Blocking district approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G-001 | Private audio storage | Student audio must not be public. | Public fallback removed; production Blob mode unverified. | `lib/audio-storage.ts` | Critical before district onboarding | Verify private Blob store in Vercel. | `[owner]` | `[date]` | Yes |
| G-002 | Blob deletion | Files deleted after record hard delete. | Implemented best-effort cleanup. | `app/api/cron/cleanup/route.ts` | High before broad school use | Monitor cleanup and verify provider deletion. | `[owner]` | `[date]` | Unknown |
| G-003 | Attachments | Assignment attachments are public URLs. | Public upload remains. | `lib/attachment-storage.ts` | High before broad school use | Decide whether attachments can contain student data; consider private attachments. | `[owner]` | `[date]` | Unknown |
| G-004 | Backups | Backup deletion/retention. | Unknown. | Provider-managed | Critical before district onboarding | Verify Vercel/Turso/Upstash backup terms. | `[owner]` | `[date]` | Yes |
| G-005 | Account deletion | Teacher/student account deletion. | Not supported. | `users` table, no route | High before broad school use | Define and implement account closure. | `[owner]` | `[date]` | Unknown |
| G-006 | Role self-promotion | Any user becoming teacher. | Production restricted by flag/allowlist. | `app/api/auth/role/route.ts` | Critical before district onboarding | Keep closed for district review. | `[owner]` | `[date]` | No if configured |
| G-007 | Roster controls | Public link submissions. | Signed-in link workflow; optional roster/domain gates. | submission route | High before broad school use | Choose district defaults. | `[owner]` | `[date]` | Unknown |
| G-008 | Subprocessor DPAs | Provider contracts. | Not verified. | docs/subprocessors.md | Critical before district onboarding | Collect provider DPAs/terms. | `[owner]` | `[date]` | Yes |
| G-009 | Incident response | Process/contact/timelines. | Not finalized. | docs placeholders | Critical before district onboarding | Draft and review incident plan. | `[owner]` | `[date]` | Yes |
| G-010 | Privacy policy/DPA | Public legal docs. | Drafts only. | docs/legal | Critical before district onboarding | Attorney review. | `[owner]` | `[date]` | Yes |
| G-011 | Insurance | Cyber/E&O coverage. | Unknown. | none | High before broad school use | Verify requirements and coverage. | `[owner]` | `[date]` | Unknown |
| G-012 | Security testing | Pen test/vulnerability scans. | Not documented. | none | Medium improvement | Define vulnerability management. | `[owner]` | `[date]` | Unknown |
| G-013 | AI usage | Student data to AI providers. | Prototype disabled. | AI route/tests | Critical before district onboarding | Keep disabled unless reviewed. | `[owner]` | `[date]` | No if disabled |
| G-014 | Production verification | Source vs live controls. | Not verified. | docs overview | Critical before district onboarding | Verify env, access, regions, cron, Blob privacy. | `[owner]` | `[date]` | Yes |
| G-015 | Data residency | Region requirements. | Unknown. | provider configs unavailable | High before broad school use | Confirm provider regions. | `[owner]` | `[date]` | Unknown |

