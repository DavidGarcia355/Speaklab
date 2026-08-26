import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("pilot legal surface", () => {
  it("publishes a concrete privacy notice without unsupported approval claims", async () => {
    const { default: PrivacyPage } = await import("@/app/privacy/page");

    const markup = renderToStaticMarkup(<PrivacyPage />);
    const lower = markup.toLowerCase();

    expect(markup).toContain("Pilot notice");
    expect(markup).toContain("TryHabla is operated by David Garcia.");
    expect(markup).toContain("Last updated: August 26, 2026");
    expect(markup).toContain("Information TryHabla handles");
    expect(markup).toContain("Optional AI grading");
    expect(markup).toContain("recorded answer");
    expect(markup).toContain("may be shown to the student before a teacher");
    expect(markup).toContain("production pilot identifies OpenAI");
    expect(markup).toContain("does not promise a particular provider retention mode");
    expect(markup).toContain("30-day");
    expect(markup).toContain("do not yet have an automatic deletion schedule");
    expect(markup).toContain("davidsgarcia325@gmail.com");
    expect(markup).toContain("TryHabla remains responsible for its own legal obligations");
    expect(markup).toContain("Stripe for optional product billing");
    expect(markup).toContain("PayPal only when a person chooses to make a separate voluntary donation");
    expect(lower).not.toContain("ferpa compliant");
    expect(lower).not.toContain("coppa compliant");
    expect(lower).not.toContain("school-approved");
    expect(lower).not.toContain("zero retention");
    expect(markup).not.toContain("[privacy contact]");
    expect(markup).not.toMatch(/\bHabla\b/);
  });

  it("keeps pilot terms conditional about AI and payments", async () => {
    const { default: TermsPage } = await import("@/app/terms/page");

    const markup = renderToStaticMarkup(<TermsPage />);
    const lower = markup.toLowerCase();

    expect(markup).toContain("Pilot terms");
    expect(markup).toContain("TryHabla is operated by David Garcia.");
    expect(markup).toContain("Optional AI results");
    expect(markup).toContain("Paid functionality is available only when it is enabled");
    expect(markup).toContain("voluntary, non-tax-deductible donations");
    expect(markup).toContain("does not purchase TryHabla, activate AI access");
    expect(markup).toContain("TryHabla product billing is handled only through Stripe");
    expect(markup).toContain("Teachers remain responsible for grading decisions");
    expect(markup).toContain('href="/privacy"');
    expect(markup).toContain("deleting an account is not yet a self-service feature");
    expect(lower).not.toContain("ferpa compliant");
    expect(lower).not.toContain("coppa compliant");
    expect(lower).not.toContain("district-approved");
    expect(markup).not.toMatch(/\bHabla\b/);
  });

  it("keeps privacy, terms, and support links in the shared footer", async () => {
    const { default: SiteFooter } = await import("@/app/components/SiteFooter");

    const markup = renderToStaticMarkup(<SiteFooter />);

    expect(markup).toContain('aria-label="Legal and support links"');
    expect(markup).toContain('href="/privacy"');
    expect(markup).toContain('href="/terms"');
    expect(markup).toContain('href="/feedback"');
    expect(markup).toContain('href="/about"');
    expect(markup).toContain("My story &amp; donations");
    expect(markup).toContain("mailto:davidsgarcia325@gmail.com");
    expect(markup).toContain("currently offered as a teacher pilot");
    expect(markup).not.toContain("paypal.me");
  });

  it("links the legal notice shown with Teacher Checkout", async () => {
    const { CheckoutAgreementNotice } = await import("@/app/billing/BillingPanel");

    const markup = renderToStaticMarkup(<CheckoutAgreementNotice />);

    expect(markup).toContain("By choosing Teacher and continuing to Stripe");
    expect(markup).toContain('href="/terms"');
    expect(markup).toContain("Terms of Use");
    expect(markup).toContain('href="/privacy"');
    expect(markup).toContain("Privacy Notice");
  });
});
