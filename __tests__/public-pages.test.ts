import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("pricing page", () => {
  it("renders the public pricing details and CTAs", async () => {
    const { default: PricingPage } = await import("@/app/pricing/page");

    const markup = renderToStaticMarkup(await PricingPage());

    expect(markup).toContain("First 20 world language teachers get Habla free forever");
    expect(markup).toContain("$9/month");
    expect(markup).toContain("$89/year");
    expect(markup).toContain("Create your teacher account");
    expect(markup).toContain("/teacher/register");
    expect(markup).toContain("Contact us");
    expect(markup).toContain("/feedback");
  });
});

describe("homepage pricing links", () => {
  it("includes visible links to the pricing page", async () => {
    const { default: HomePage } = await import("@/app/page");

    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("View pricing");
    expect(markup).toContain("/pricing");
    expect(markup).toContain("$9/month or $89/year teacher plan");
  });
});

describe("faq pricing copy", () => {
  it("keeps FAQ messaging aligned with beta and paid plans", async () => {
    const { default: FaqPage } = await import("@/app/faq/page");

    const markup = renderToStaticMarkup(await FaqPage());

    expect(markup).toContain("What does Habla cost after beta?");
    expect(markup).toContain("$9/month or $89/year");
    expect(markup).toContain("View pricing");
    expect(markup).toContain("/pricing");
    expect(markup).not.toContain("Request pilot access");
  });
});
