import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("pricing page", () => {
  it("renders the public pricing details and CTAs", async () => {
    const { default: PricingPage } = await import("@/app/pricing/page");

    const markup = renderToStaticMarkup(await PricingPage());

    expect(markup).toContain("Free teacher access during the launch beta");
    expect(markup).toContain("Teacher accounts are free during the launch beta");
    expect(markup).toContain("$0 today");
    expect(markup).toContain("No payment method or checkout required");
    expect(markup).toContain("Future pricing is not finalized");
    expect(markup).toContain("Create your teacher account");
    expect(markup).toContain("/teacher/register");
    expect(markup).toContain("Department coverage for multiple teachers");
    expect(markup).toContain("Contact us");
    expect(markup).toContain("/feedback");
    expect(markup).toContain("No claim of district approval until review is complete");
    expect(markup).not.toContain("$9/month");
    expect(markup).not.toContain("$89/year");
    expect(markup).not.toContain("June 2026");
    expect(markup).not.toContain("free access forever");
    expect(markup).not.toContain("Coming soon for schools");
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
    expect(markup).toContain("AI drafts. Teachers decide.");
    expect(markup).toContain("Nothing becomes a grade until the teacher reviews and saves it");
    expect(markup).not.toContain("June 2026");
    expect(markup).not.toContain("free access forever");
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

    expect(teacherMarkup).toContain("Review an AI draft");
    expect(teacherMarkup).toContain("teacher makes the final call");
    expect(studentMarkup).toContain("Record in browser");
    expect(studentMarkup).toContain("Teacher feedback");
    expect(studentMarkup).not.toContain("Habla points");
    expect(studentMarkup).not.toContain("streak");
    expect(studentMarkup).not.toContain("Submit securely");
    expect(districtMarkup).toContain("controlled teacher pilot");
    expect(districtMarkup).toContain("private audio storage");
  });
});

describe("faq pricing copy", () => {
  it("keeps FAQ messaging aligned with beta and paid plans", async () => {
    const { default: FaqPage } = await import("@/app/faq/page");

    const markup = renderToStaticMarkup(await FaqPage());

    expect(markup).toContain("Access and district review");
    expect(markup).toContain("Teacher accounts are free during the launch beta");
    expect(markup).toContain("Getting started");
    expect(markup).toContain("Students and submissions");
    expect(markup).toContain("production storage settings must be verified");
    expect(markup).not.toContain("June 2026");
    expect(markup).not.toContain("FERPA compliant");
  });
});
