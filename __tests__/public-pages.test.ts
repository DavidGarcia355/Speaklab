import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("pricing page", () => {
  it("renders the public pricing details and CTAs", async () => {
    const { default: PricingPage } = await import("@/app/pricing/page");

    const markup = renderToStaticMarkup(await PricingPage());

    expect(markup).toContain("First 20 world language teachers get Habla free forever");
    expect(markup).toContain("$4.99/month");
    expect(markup).toContain("$39.95/year");
    expect(markup).toContain("Create your teacher account");
    expect(markup).toContain("/teacher/register");
    expect(markup).toContain("Department coverage for multiple teachers");
    expect(markup).toContain("Contact us");
    expect(markup).toContain("/feedback");
    expect(markup).not.toContain("$9/month");
    expect(markup).not.toContain("$89/year");
    expect(markup).not.toContain("Coming soon for schools");
  });
});

describe("homepage pricing links", () => {
  it("includes visible links to the pricing page", async () => {
    const { default: HomePage } = await import("@/app/page");

    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("View pricing");
    expect(markup).toContain("/pricing");
    expect(markup).toContain("$4.99/month or $39.95/year");
    expect(markup).toContain("departments can contact us");
  });
});

describe("faq pricing copy", () => {
  it("keeps FAQ messaging aligned with beta and paid plans", async () => {
    const { default: FaqPage } = await import("@/app/faq/page");

    const markup = renderToStaticMarkup(await FaqPage());

    expect(markup).toContain("$4.99/month or $39.95/year");
    expect(markup).toContain("Everything teachers ask about Habla");
    expect(markup).toContain("Getting started");
    expect(markup).toContain("How it works");
    expect(markup).toContain("Pricing and beta");
    expect(markup).toContain("View pricing");
    expect(markup).toContain("/pricing");
  });
});
