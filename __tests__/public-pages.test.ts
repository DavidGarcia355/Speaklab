import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("pricing page", () => {
  it("renders the public pricing details and CTAs", async () => {
    const { default: PricingPage } = await import("@/app/pricing/page");

    const markup = renderToStaticMarkup(await PricingPage());

    expect(markup).toContain("Use Habla forever");
    expect(markup).toContain("Audio learning stays free");
    expect(markup).toContain("$0");
    expect(markup).toContain("forever — no subscription");
    expect(markup).toContain("Simple pricing that fits your classroom");
    expect(markup).toContain("See what you would pay before turning AI on");
    expect(markup).toContain("one fewer than your active class count");
    expect(markup).toContain("Estimated monthly price");
    expect(markup).toContain("what you would pay Habla");
    expect(markup).toContain("Get teacher access");
    expect(markup).toContain("/teacher/register");
    expect(markup).toContain("5¢");
    expect(markup).toContain("1¢");
    expect(markup).toContain("AI feedback");
    expect(markup).toContain("Included");
    expect(markup).toContain(
      "All proceeds from Habla go toward my mom&#x27;s fight against endometrial cancer.",
    );
    expect(markup).toContain('data-awareness-ribbon="peach"');
    expect(markup).toContain("Read my story");
    expect(markup).toContain("Set up AI billing");
    expect(markup).toContain("/billing");
    expect(markup).toContain("District pricing is completely separate");
    expect(markup).toContain("Contact Habla");
    expect(markup).toContain("/feedback");
    expect(markup).toContain("does not quote a district rollout or imply district approval");
    expect(markup).not.toContain("$9/month");
    expect(markup).not.toContain("$89/year");
    expect(markup).not.toContain("June 2026");
    expect(markup).not.toContain("Coming soon for schools");
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
    expect(markup).toContain("Checking your billing access");
    expect(markup).toContain("payment details are handled by Stripe");
    expect(markup).toContain("/pricing");
    expect(markup).not.toContain("recorded retail usage");
  });
});

describe("public audience paths", () => {
  it("routes each audience to a truthful product story", async () => {
    const { default: HomePage } = await import("@/app/page");

    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("/district");
    expect(markup).toContain("/teachers");
    expect(markup).toContain("/students");
    expect(markup).toContain("585");
    expect(markup).toContain("AI grades. Teachers stay in control.");
    expect(markup).toContain("edit the grade anytime");
    expect(markup).not.toContain("June 2026");
    expect(markup).toContain("core audio classroom is free forever");
    expect(markup).not.toContain("Habla points");
    expect(markup).not.toContain("badges");
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

    expect(teacherMarkup).toContain("Grade with AI");
    expect(teacherMarkup).toContain("review or edit every result");
    expect(studentMarkup).toContain("Record in browser");
    expect(studentMarkup).toContain("Teacher feedback");
    expect(studentMarkup).not.toContain("Habla points");
    expect(studentMarkup).not.toContain("streak");
    expect(studentMarkup).not.toContain("Submit securely");
    expect(districtMarkup).toContain("controlled teacher pilot");
    expect(districtMarkup).toContain("private audio storage");
  });
});

describe("about page", () => {
  it("tells David's story briefly and links the family support action", async () => {
    const [{ default: AboutPage }, { default: HomePage }] = await Promise.all([
      import("@/app/about/page"),
      import("@/app/page"),
    ]);

    const markup = renderToStaticMarkup(await AboutPage());
    const homeMarkup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("Hi, I&#x27;m David.");
    expect(markup).toContain("college student building Habla");
    expect(markup).toContain("My mom is fighting endometrial cancer.");
    expect(markup).toContain("Help my mom&#x27;s fight against endometrial cancer");
    expect(markup).toContain('data-awareness-ribbon="peach"');
    expect(markup).toContain("https://paypal.me/DavidGarcia355");
    expect(homeMarkup).toContain("href=\"/about\"");
    expect(homeMarkup).toContain("About me");
  });
});

describe("faq pricing copy", () => {
  it("keeps FAQ messaging aligned with free core and metered AI", async () => {
    const { default: FaqPage } = await import("@/app/faq/page");

    const markup = renderToStaticMarkup(await FaqPage());

    expect(markup).toContain("Access and district review");
    expect(markup).toContain("core audio classroom is free forever");
    expect(markup).toContain("How does optional AI pricing work?");
    expect(markup).toContain("one fewer free AI grade");
    expect(markup).toContain("5 cents per successful grade plus 1 cent per audio minute");
    expect(markup).toContain("feedback included");
    expect(markup).toContain("Sign in to the AI billing page to check self-serve availability");
    expect(markup).toContain("Does AI save the grade automatically?");
    expect(markup).toContain("saves a whole-point score");
    expect(markup).toContain("Getting started");
    expect(markup).toContain("Students and submissions");
    expect(markup).toContain("production storage settings must be verified");
    expect(markup).not.toContain("June 2026");
    expect(markup).not.toContain("FERPA compliant");
    expect(markup.toLowerCase()).not.toContain("token");
  });
});
