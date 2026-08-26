# TryHabla pricing decision brief

Status: accepted launch packaging decision on August 26, 2026. This decision authorizes implementation and Stripe sandbox verification, but not a production deployment or public promotion before the release gates pass.

## Recommendation

Launch two public choices plus a contact-based school sales path:

| Plan | Price | AI allowance | Plain-English capacity |
| --- | ---: | ---: | --- |
| Free | $0 | 30 successful AI-reviewed submissions as an initial trial | One complete assignment for a 30-student class |
| Teacher | $20/month | 300 successful AI-reviewed submissions per Stripe billing period | Ten 30-student class-assignment runs, or two assignments in each of five 30-student classes |
| TryHabla for Schools | Contact us | Scoped during onboarding | Larger or custom teacher cohorts supported by TryHabla |

A class-assignment run means one submission from every student in that class. The estimate is:

`included reviews / students per class / number of classes`

Use **AI-reviewed submissions** in customer copy, not provider costs, tokens, minutes, or an abstract credit exchange rate. Count a review only when TryHabla successfully delivers a usable AI result. Failures, unable-to-grade results, and exact retries should not consume the allowance.

Every paid tier should retain the five-minute recording limit, reset on the customer's Stripe billing date, have no rollover, and stop before an overage. Reaching the limit should pause AI only; recording, playback, and manual grading remain available.

At 300 reviews, show: **Need more AI reviews? Explore TryHabla for Schools.**

## Classroom capacity

| Allowance | 25-student class | 30-student class | Example multi-class use |
| ---: | ---: | ---: | --- |
| 30 | 1 full run, with 5 reviews left | 1 full run | Trial one real assignment |
| 300 | 12 full runs | 10 full runs | 4 classes of 25 × 3 assignments, or 5 classes of 30 × 2 assignments |

The pricing page should eventually include a small calculator with three inputs: number of classes, students per class, and assignments per month.

## Why this is better than the rejected rate card

- The teacher sees one product, one monthly price, one allowance, and one reset date.
- Checkout collects a known amount up front instead of showing multiple variable-price rows and `$0 due today`.
- The price is tied to classroom capacity and teacher time saved, not TryHabla's vendor bill.
- A hard cap protects both the teacher and TryHabla. There are no surprise invoices.
- The existing Stripe customer portal remains the right cancellation and payment-management experience.

There should be no public $99 tier at launch. High-volume demand should enter through the TryHabla for Schools contact path until real usage and buying behavior are measured.

## TryHabla for Schools boundary

A code audit on August 26, 2026 found that TryHabla has a real founder/operator dashboard, but not a school-scoped administrator:

| Capability | Current state |
| --- | --- |
| Manage multiple teacher accounts | The founder can view teachers and toggle manual AI access; a school admin cannot invite, remove, suspend, or scope teachers. |
| See school-wide usage | The founder sees platform-wide counts; there is no school membership or school-filtered usage view. |
| Control access and billing | The founder can issue an explicit, provenance-tagged manual AI grant; Stripe Customers, Checkout, and Portal are owned by individual teacher emails. |
| View data across teachers | The founder sees summary counts and class names; detailed classroom, recording, and grade routes remain teacher-owner scoped. |

The safe current offer is therefore **TryHabla for Schools - contact us**, meaning larger or custom teacher cohorts scoped and supported by TryHabla. It must not claim that the school receives an admin console, consolidated Stripe billing, or cross-teacher student-data access. A school contact must never be added to the global `ADMIN_EMAILS` list because that would expose platform-wide data.

A later self-service TryHabla for Schools plan needs the four controls in the deciding test: school membership and teacher management, school-scoped usage, school-owned access/billing, and explicitly authorized cross-teacher views with cross-school isolation tests. SIS integrations, purchase orders, and advanced district reporting are not prerequisites for an initial school rollout.

## Unit economics

These are planning estimates, not verified production margins.

Assumptions:

- `gpt-4o-mini-transcribe` at the published estimated rate of $0.003 per audio minute.
- A conservative grading request of about 3,000 input tokens and 2,400 output tokens on `gpt-5-nano`.
- Ten percent of reviews escalate to `gpt-5-mini`.
- A 25% retry/failure cushion.
- Stripe US domestic-card processing at 2.9% + $0.30, plus Stripe Billing at 0.7% of Billing volume.
- Vercel, Turso, Blob, support time, refunds, taxes, and fixed company costs are excluded.

| Average recording | Estimated provider cost per successful review | Provider cost for 300 | $20 contribution after estimated Stripe + provider cost | Pre-infrastructure margin |
| ---: | ---: | ---: | ---: | ---: |
| 1 minute | $0.0058 | $1.75 | $17.23 | 86% |
| 3 minutes | $0.0133 | $4.00 | $14.98 | 75% |
| 5 minutes | $0.0208 | $6.25 | $12.73 | 64% |

The $20/300 plan is economically plausible. It meets roughly a 70% pre-infrastructure margin when typical recordings average about three minutes or less. The all-five-minute case is still positive, but leaves less room for hosting and support.

The former $99/1,500 option remains useful as internal sensitivity analysis, but should not be published. TryHabla for Schools pricing and capacity can be quoted after TryHabla understands the cohort size and expected assignment volume.

## The Free-plan fork

Two reasonable versions need a deliberate choice:

1. **Safer launch: 30 successful reviews once.** This proves the workflow on one real class while capping AI customer-acquisition cost.
2. **Stronger growth loop: 30 successful reviews every month.** This is more competitive and keeps free teachers engaged, but creates an ongoing cost liability. At the conservative five-minute estimate, 1,000 fully active free teachers could consume about $625/month in provider cost before infrastructure.

Recommendation: start with a one-time allowance, keep the non-AI product free, and revisit a recurring free allowance after activation and conversion are measured.

## High-volume options

| Option | Customer experience | Launch risk | Recommendation |
| --- | --- | --- | --- |
| Automatic metered overages | Variable bill after use; requires clear unit rates | Highest: recreates the confusing multi-line Checkout, reconciliation burden, and bill-shock risk | Do not launch |
| Prepaid review packs | Known one-time price; AI pauses until the teacher opts in | Medium: requires a purchase flow and durable balance ledger | Best future bridge |
| Fixed $99 tier | One Checkout row and predictable monthly bill | Unproven demand and no school-level product controls | Do not publish yet |
| TryHabla for Schools - contact us | Larger or custom teacher cohort with scoped terms | Requires direct onboarding and an honest feature boundary | Sales path for schools and teachers who outgrow 300 |

Prepaid packs are better than postpaid overages for this audience. A provisional example is 100 additional successful reviews for $10, but no pack size or price should be published until the $20 cohort's real cost and usage distribution are known.

## What the market suggests

- [Speakable](https://www.speakable.io/pricing) offers a free teacher plan with a monthly AI allowance and prepaid top-ups, then annual teacher and organization plans. That validates an allowance-and-pack model without exposing vendor costs.
- [Viva Vocina](https://viva.vocina.ai/pricing) publishes free and paid minute allowances plus prepaid minute packs. Its prices are in NZD, so they are packaging evidence rather than a direct USD anchor.
- [Class Companion](https://classcompanion.com/plans) keeps its teacher product free and sells school/district capabilities through a sales motion. That supports separating individual self-service pricing from a future institutional product.
- Stripe supports flat-rate, tiered, usage-based, and credit-burndown structures. Its own integration guide distinguishes predictable prepaid access from postpaid metered usage. [Stripe subscription-model guide](https://docs.stripe.com/billing/subscriptions/design-an-integration)

## Evidence required before publishing a high-volume self-service tier

Collect at least 30 days of sandbox or production measurements:

- median, p90, and p95 recording duration;
- provider cost per delivered review, including transcription, retries, and escalation;
- cache-hit and exact-retry rates;
- reviews per active paid teacher and the p90/p95 distribution;
- storage and egress per review;
- support time per paid teacher;
- how often teachers hit 300 and ask for more;
- conversion from the free AI trial to Teacher.

Suggested guardrails:

- at least 70% pre-support margin at typical usage;
- at least 55–60% in a documented heavy-use scenario;
- a global provider-spend ceiling;
- an atomic per-plan allowance reservation before any paid provider call;
- no public “unlimited” claim.

## Accepted launch decision

1. Free includes 30 successful AI reviews once.
2. Teacher costs $20/month and includes 300 successful AI reviews per Stripe billing period.
3. TryHabla for Schools is `Contact us` and is scoped directly with TryHabla.
4. There is no public $99 plan and no automatic overage billing at launch.
5. Prepaid packs and annual Teacher pricing wait until real retention and cap-hit data exist.

The Teacher Stripe Product can be recreated only after the 300-review hard cap and counting rules are implemented and tested. TryHabla for Schools is not a self-service Stripe plan.

## Prompt for independent model review

> Act as a skeptical SaaS pricing strategist and unit-economics reviewer for TryHabla, an AI-assisted speaking-assessment product for teachers. Core recording, playback, and manual grading stay free. A successful AI review transcribes a student recording of up to five minutes and returns rubric scoring and feedback. Failures, unable-to-grade results, and exact retries do not count. Evaluate this launch decision: Free with 30 AI reviews once; Teacher at $20/month with 300 reviews; TryHabla for Schools as a contact-based path for larger or custom needs; no public $99 plan; no automatic overages; possible prepaid packs later. One 30-student class assignment consumes 30 successful reviews. Conservative provider cost is approximately $0.0058/$0.0133/$0.0208 per successful 1/3/5-minute review. Stripe costs approximately 2.9% + $0.30 plus 0.7% Billing volume before international-card or tax costs. The product currently has a global founder dashboard and teacher-level entitlements, but no school-scoped administrator or consolidated school billing. Recommend whether this packaging is honest, identify the strongest objection, calculate margins and classroom capacity, and list the minimum evidence needed before publishing a high-volume tier. Do not recommend unlimited usage or hide variable customer charges.

## Sources

- [OpenAI API pricing](https://platform.openai.com/pricing)
- [GPT-5 nano model pricing](https://developers.openai.com/api/docs/models/gpt-5-nano)
- [GPT-4o Mini Transcribe](https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe)
- [Stripe Payments pricing](https://stripe.com/pricing)
- [Stripe Billing pricing](https://stripe.com/billing/pricing)
- [Stripe subscription-model guide](https://docs.stripe.com/billing/subscriptions/design-an-integration)
