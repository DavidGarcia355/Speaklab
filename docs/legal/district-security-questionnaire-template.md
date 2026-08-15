# District Security Questionnaire Template

Draft answers for preliminary review. Labels indicate evidence level.

| Question | Label | Draft answer |
| --- | --- | --- |
| What student data is collected? | Implemented and verified in code | Names, emails, audio recordings, submissions, grades, rubric scores, feedback, timestamps, roster membership, assignments, and optional attachments. See data inventory. |
| Why is each category needed? | Implemented and verified in code | To authenticate students, associate recordings, allow teacher review/grading, organize classes, and export grades. |
| Is student data sold? | Requires legal review | No sale code is present; a legal policy statement requires review. |
| Is student data used for advertising? | Implemented and verified in code | No advertising code was found. |
| Is student data used to train AI? | Experimental and disabled | AI grading is disabled by default; no training use is implemented in code. |
| Are recordings shared with third parties? | Deployment verification required | Recordings are stored in Vercel Blob; AI providers receive none while AI is disabled. |
| Where is data stored? | Deployment verification required | App DB is Turso/libSQL and files are Vercel Blob; regions must be verified. |
| Is data encrypted in transit? | Deployment verification required | HTTPS is expected in production; live deployment must be verified. |
| Is data encrypted at rest? | Deployment verification required | Provider encryption details must be verified with providers. |
| Who can access student information? | Implemented and verified in code | Assigning teacher via ownership checks; admin can view aggregate/admin data; provider/operator access requires policy. |
| How are teachers authorized? | Implemented and verified in code | `users.role='teacher'`, proxy/API checks, class owner email checks. |
| How are students authenticated? | Implemented and verified in code | NextAuth OAuth session before submission. |
| Does Habla request broad Google scopes? | Deployment verification required | Repository uses standard NextAuth Google provider; exact OAuth consent screen/scopes must be verified. |
| Can a district restrict access by domain? | Implemented and verified in code | `ENFORCE_STUDENT_DOMAIN` and `STUDENT_DOMAIN`. |
| Can a district request deletion? | Documented policy decision required | Technical deletion exists for classes/assignments/submissions/audio; request workflow needs business/legal decision. |
| How quickly is data deleted? | Implemented and verified in code | Soft-deleted class/assignment/submission rows hard-delete after 30 days via cron if configured. Other categories need decisions. |
| Are backups deleted? | Deployment verification required | Provider backup retention is unknown from source. |
| Which subprocessors are used? | Implemented and verified in code | See `docs/subprocessors.md`. |
| Is a DPA available? | Requires legal review | Draft template exists for attorney/district review; not finalized. |
| Is Habla FERPA compliant? | Requires legal review | Do not claim compliance. Source shows controls that may support review, but legal determination is required. |
| Is Habla COPPA compliant? | Requires legal review | Do not claim compliance. Responsibilities require district/legal review. |
| Has Habla completed SOC 2? | Not currently supported | No SOC 2 evidence in repository. |
| Does Habla carry cyber insurance? | Documented policy decision required | Unknown; provide only verified coverage. |
| What is incident response? | Documented policy decision required | Technical contacts/process need definition. |
| Breach notification timeline? | Requires legal review | Placeholder; do not promise until reviewed. |
| Penetration testing? | Not currently supported | No evidence in repository. |
| Vulnerability scans? | Documented policy decision required | No recurring process documented. |
| MFA available? | Deployment verification required | Depends on OAuth provider/account policies. |
| Audit logs available? | Not currently supported | Activity events exist, but no district audit export. |
| Are AI features used? | Experimental and disabled | Disabled by default with `AI_GRADING_ENABLED=false`. |
| Can AI be disabled? | Implemented and verified in code | Yes; disabled by default. |
| Can the district export data? | Partially supported | CSV gradebook export exists; full district export not implemented. |
| Contract termination? | Documented policy decision required | Return/deletion workflow needs definition. |

