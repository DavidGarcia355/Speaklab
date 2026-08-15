# Public Copy Changes

| File | Old meaning | New meaning | Reason |
| --- | --- | --- | --- |
| `app/page.tsx` | Habla was free through June 2026, beta changed in August, and early teachers received free access forever. | Habla is preparing for the 2026-2027 school year; pricing and rollout terms are not finalized in the app. | June 2026 is past, August timing is ambiguous, and free-forever claims require a business decision. |
| `app/pricing/page.tsx` | Published specific individual pricing and beta terms. | States no self-serve checkout, access terms under review, and district documentation path. | Avoids inventing pricing or availability for district review. |
| `app/faq/page.tsx` | Claimed student audio was securely stored and not public without noting deployment verification. | Describes implemented access checks and states production storage settings must be verified. | Source code can verify authorization paths, not live Blob configuration. |
| `app/faq/page.tsx` | Implied only Google sign-in and broad account limitations. | States Google is base auth and Microsoft is optional when configured. | Matches `auth.ts`. |
| `__tests__/public-pages.test.ts` | Expected stale beta/pricing copy. | Expects 2026-2027 readiness and no expired claims. | Keeps tests aligned with truthful public content. |

