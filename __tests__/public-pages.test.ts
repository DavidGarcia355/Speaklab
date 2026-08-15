import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("pricing page", () => {
  it("renders the public pricing details and CTAs", async () => {
    const { default: PricingPage } = await import("@/app/pricing/page");

    const markup = renderToStaticMarkup(await PricingPage());

    expect(markup).toContain("Access information for the 2026-2027 school year");
    expect(markup).toContain("No self-serve checkout");
    expect(markup).toContain("pricing is not finalized in the product");
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

describe("homepage pricing links", () => {
  it("includes visible links to the pricing page", async () => {
    const { default: HomePage } = await import("@/app/page");

    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("View pricing");
    expect(markup).toContain("/pricing");
    expect(markup).toContain("Preparing Habla for renewed classroom use and district review");
    expect(markup).toContain("Public pricing and broad rollout terms are not finalized");
    expect(markup).not.toContain("June 2026");
    expect(markup).not.toContain("free access forever");
  });
});

describe("faq pricing copy", () => {
  it("keeps FAQ messaging aligned with beta and paid plans", async () => {
    const { default: FaqPage } = await import("@/app/faq/page");

    const markup = renderToStaticMarkup(await FaqPage());

    expect(markup).toContain("Access and district review");
    expect(markup).toContain("Access terms for the 2026-2027 school year");
    expect(markup).toContain("Getting started");
    expect(markup).toContain("Students and submissions");
    expect(markup).toContain("production storage settings must be verified");
    expect(markup).not.toContain("June 2026");
    expect(markup).not.toContain("FERPA compliant");
  });
});
