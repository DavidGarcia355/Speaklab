import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("pricing page", () => {
  it("renders the public pricing details and CTAs", async () => {
    const { default: PricingPage } = await import("@/app/pricing/page");

    const markup = renderToStaticMarkup(await PricingPage());

    expect(markup).toContain("Start free. Add AI when it saves you time.");
    expect(markup).toContain("The complete audio classroom, plus a lifetime AI allowance");
    expect(markup).toContain("$0");
    expect(markup).toContain("30 AI-assisted recordings for the lifetime of your teacher account");
    expect(markup).toContain("no card required");
    expect(markup).toContain("Teacher");
    expect(markup).toContain("$20");
    expect(markup).toContain("300 AI-assisted recordings in each Stripe billing period");
    expect(markup).toContain("A clean transcript is included; AI grading is optional");
    expect(markup).toContain("Transcribing and grading the same recording uses one unit total");
    expect(markup).toContain("full assignments for one class of 30 students");
    expect(markup).toContain("full assignments across five classes of 30 students");
    expect(markup).toContain("No automatic overages");
    expect(markup).toContain("Start free");
    expect(markup).toContain("/teacher/register");
    expect(markup).toContain("AI feedback");
    expect(markup).toContain(
      "Revenue from Teacher helps me operate the service, keep the core classroom free, and support my family while my mom fights endometrial cancer.",
    );
    expect(markup).toContain('data-awareness-ribbon="peach"');
    expect(markup).toContain("Read my story");
    expect(markup).toContain("View Teacher billing");
    expect(markup).toContain("/billing");
    expect(markup).toContain("PayPal is for voluntary, non-tax-deductible donations only");
    expect(markup).toContain("TryHabla product billing is handled only through Stripe");
    expect(markup).toContain("Donate via PayPal");
    expect(markup).not.toContain("Support with PayPal");
    expect(markup).not.toMatch(/\bHabla\b/);
    expect(markup).toContain("not a usage charge or invoice");
    expect(markup).toContain("TryHabla for Schools - Contact us");
    expect(markup).toContain("Larger and custom school needs.");
    expect(markup).toContain("Need more AI-assisted recordings? Explore TryHabla for Schools.");
    expect(markup).toContain("Contact us");
    expect(markup).toContain("/feedback");
    expect(markup).toContain("does not currently imply a school admin console or district approval");
    expect(markup).not.toContain("$9/month");
    expect(markup).not.toContain("$89/year");
    expect(markup).not.toContain("$99");
    expect(markup).not.toContain("June 2026");
    expect(markup).not.toContain("Coming soon for schools");
    expect(markup).not.toMatch(/(?:teacher|school) pilot|request a pilot/i);
    expect(markup.toLowerCase()).not.toContain("credit");
    expect(markup.toLowerCase()).not.toContain("per successful grade");
    expect(markup.toLowerCase()).not.toContain("per audio minute");
    expect(markup).not.toContain("OpenAI");
    expect(markup).not.toContain("provider retries");
    expect(markup).not.toContain("internal retries");
    expect(markup).not.toContain("model escalation");
    expect(markup).not.toContain("model output");
    expect(markup).not.toContain("retry traffic");
    expect(markup).not.toContain("profit margin");
    expect(markup).not.toContain("gross margin");
    expect(markup).not.toContain("break-even");
    expect(markup).not.toContain("hosting cost");
    expect(markup).not.toContain("payment processing fee");
    expect(markup).not.toContain("provider cost");
    expect(markup.toLowerCase()).not.toContain("token");
  });
});

describe("billing page", () => {
  it("keeps core access separate from optional Stripe billing", async () => {
    const { default: BillingPage } = await import("@/app/billing/page");

    const markup = renderToStaticMarkup(await BillingPage());

    expect(markup).toContain("Keep the classroom free");
    expect(markup).toContain("Core stays $0");
    expect(markup).toContain("Checking my billing access");
    expect(markup).toContain("Stripe is TryHabla&#x27;s only product-payment method");
    expect(markup).toContain("voluntary, non-tax-deductible donations only");
    expect(markup).toContain("30 AI-assisted recordings per teacher account");
    expect(markup).toContain("$20 per month for 300 per Stripe billing period");
    expect(markup).toContain("no automatic overages");
    expect(markup).toContain("never purchase access, start or extend a subscription, or add AI-assisted recording units");
    expect(markup).not.toContain("paypal.me");
    expect(markup).not.toMatch(/\bHabla\b/);
    expect(markup).toContain("/pricing");
    expect(markup).not.toContain("recorded retail usage");
    expect(markup).not.toContain("$99");
  });
});

describe("public audience paths", () => {
  it("keeps the shared footer compact and audience-neutral", async () => {
    const { default: SiteFooter } = await import("@/app/components/SiteFooter");

    const markup = renderToStaticMarkup(SiteFooter());

    expect(markup).toContain("TryHabla");
    expect(markup).toContain('href="/faq"');
    expect(markup).not.toContain("AI-assisted recordings");
    expect(markup).not.toMatch(/pilot|request access|invite-only/i);
  });

  it("routes each audience to a truthful product story", async () => {
    const { default: HomePage } = await import("@/app/page");

    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("/district");
    expect(markup).toContain("/teachers");
    expect(markup).toContain("/students");
    expect(markup).toContain("Already learning from real classroom use");
    expect(markup).not.toContain("<strong>37</strong>");
    expect(markup).not.toContain("<strong>141</strong>");
    expect(markup).not.toContain("<strong>585</strong>");
    expect(markup).toContain("Transcribe first. Grade with AI only when it helps.");
    expect(markup).toContain("generate a clean transcript to copy or download");
    expect(markup).not.toContain("June 2026");
    expect(markup).toContain(
      "Free includes the complete audio classroom and a lifetime allowance of 30 AI-assisted",
    );
    expect(markup).toContain("Teacher adds 300 per Stripe billing period for $20");
    expect(markup).toContain("Larger and custom needs can go through TryHabla for Schools");
    expect(markup).not.toContain("Habla points");
    expect(markup).not.toContain("badges");
    expect(markup).not.toMatch(/\bHabla\b/);
  });

  it("keeps teacher, student, and district claims aligned with implemented behavior", async () => {
    const [{ default: TeachersPage }, { default: StudentsPage }, { default: DistrictPage }] =
      await Promise.all([
        import("@/app/teachers/page"),
        import("@/app/students/page"),
        import("@/app/district/page"),
      ]);

    const teacherMarkup = renderToStaticMarkup(await TeachersPage());
    const studentMarkup = renderToStaticMarkup(await StudentsPage());
    const districtMarkup = renderToStaticMarkup(await DistrictPage());

    expect(teacherMarkup).toContain("Transcribe or grade with AI");
    expect(teacherMarkup).toContain("Generate a transcript to copy or download");
    expect(studentMarkup).toContain("Record in browser");
    expect(studentMarkup).toContain("Teacher feedback");
    expect(studentMarkup).not.toContain("Habla points");
    expect(studentMarkup).not.toContain("streak");
    expect(studentMarkup).not.toContain("Submit securely");
    expect(districtMarkup).toContain("Teachers can start self-serve");
    expect(districtMarkup).toContain("private audio storage");
    expect(`${teacherMarkup}${districtMarkup}`).not.toMatch(
      /(?:teacher|school) pilot|request (?:a )?pilot/i,
    );
    expect(`${teacherMarkup}${studentMarkup}${districtMarkup}`).not.toMatch(/\bHabla\b/);
  });
});

describe("about page", () => {
  it("presents David and TryHabla professionally with verified contact links", async () => {
    const [{ default: AboutPage }, { default: HomePage }] = await Promise.all([
      import("@/app/about/page"),
      import("@/app/page"),
    ]);

    const markup = renderToStaticMarkup(await AboutPage());
    const homeMarkup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("Hi, I&#x27;m David Garcia.");
    expect(markup).toContain("college student who built TryHabla for my mom");
    expect(markup).toContain("My mom is why TryHabla exists.");
    expect(markup).toContain("She is a Spanish teacher fighting recurrent endometrial cancer.");
    expect(markup).toContain("Official TryHabla links");
    expect(markup).not.toContain("Speaking assignments should feel manageable.");
    expect(markup).not.toContain("storm");
    expect(markup).not.toContain("Portage");
    expect(markup).not.toContain("our home");
    expect(markup).not.toContain("air conditioning");
    expect(markup).toContain("Support her fight");
    expect(markup).toContain("PayPal is for voluntary, non-tax-deductible donations only");
    expect(markup).toContain('data-awareness-ribbon="peach"');
    expect(markup).toContain("https://paypal.me/DavidGarcia355");
    expect(markup).toContain("https://www.linkedin.com/in/david-garcia-78b93328a");
    expect(markup).toContain("https://www.linkedin.com/company/tryhabla");
    expect(markup).toContain("https://www.facebook.com/tryhabla");
    expect(markup).toContain("mailto:davidsgarcia325@gmail.com");
    expect(markup).not.toMatch(/\bHabla\b/);
    expect(homeMarkup).toContain("href=\"/about\"");
    expect(homeMarkup).toContain("About TryHabla");
    expect(homeMarkup).toContain("Built for my mom. Supporting her fight.");
    expect(homeMarkup).toContain("She is the reason");
    expect(homeMarkup).not.toContain("storm");
    expect(homeMarkup).not.toContain("Portage");
    expect(homeMarkup).not.toContain("our home");
    expect(homeMarkup).not.toContain("air conditioning");
  });
});

describe("faq pricing copy", () => {
  it("keeps FAQ messaging aligned with Free, Teacher, and TryHabla for Schools", async () => {
    const { default: FaqPage } = await import("@/app/faq/page");

    const markup = renderToStaticMarkup(await FaqPage());

    expect(markup).toContain("Access and district review");
    expect(markup).toContain(
      "lifetime allowance of 30 AI-assisted recordings per teacher account",
    );
    expect(markup).toContain("How does optional AI pricing work?");
    expect(markup).toContain(
      "Teacher is $20 per month and includes 300 AI-assisted recordings in each Stripe billing period",
    );
    expect(markup).toContain("there are no automatic overages");
    expect(markup).toContain("Contact TryHabla for Schools");
    expect(markup).toContain("larger and custom path for schools");
    expect(markup).toContain("does not currently include a school admin console");
    expect(markup).toContain("Does AI save the grade automatically?");
    expect(markup).toContain("generate, copy, or download a transcript without requesting an AI grade");
    expect(markup).toContain("prepares suggested whole-point scores");
    expect(markup).toContain("remain teacher-only");
    expect(markup).toContain("explicitly saves the final grades");
    expect(markup).not.toContain("saves a whole-point score");
    expect(markup).toContain("Getting started");
    expect(markup).toContain("Students and submissions");
    expect(markup).toContain("production storage settings must be verified");
    expect(markup).not.toContain("June 2026");
    expect(markup).not.toContain("FERPA compliant");
    expect(markup).not.toContain("$99");
    expect(markup).not.toMatch(/(?:teacher|school) pilot|request a pilot/i);
    expect(markup.toLowerCase()).not.toContain("credit");
    expect(markup.toLowerCase()).not.toContain("per successful grade");
    expect(markup.toLowerCase()).not.toContain("per audio minute");
    expect(markup.toLowerCase()).not.toContain("token");
    expect(markup).not.toMatch(/\bHabla\b/);
  });
});
