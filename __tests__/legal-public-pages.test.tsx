import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("pilot legal surface", () => {
  it("publishes a concrete privacy notice without unsupported approval claims", async () => {
    const { default: PrivacyPage } = await import("@/app/privacy/page");

    const markup = renderToStaticMarkup(<PrivacyPage />);
    const lower = markup.toLowerCase();

    expect(markup).toContain("Pilot notice");
    expect(markup).toContain("Last updated: August 25, 2026");
    expect(markup).toContain("Information Habla handles");
    expect(markup).toContain("Optional AI grading");
    expect(markup).toContain("recorded answer");
    expect(markup).toContain("may be shown to the student before a teacher");
    expect(markup).toContain("production pilot identifies OpenAI");
    expect(markup).toContain("does not promise a particular provider retention mode");
    expect(markup).toContain("30-day");
    expect(markup).toContain("do not yet have an automatic deletion schedule");
    expect(markup).toContain("davidsgarcia325@gmail.com");
    expect(markup).toContain("Habla remains responsible for its own legal obligations");
    expect(lower).not.toContain("ferpa compliant");
    expect(lower).not.toContain("coppa compliant");
    expect(lower).not.toContain("school-approved");
    expect(lower).not.toContain("zero retention");
    expect(markup).not.toContain("[privacy contact]");
  });

  it("keeps pilot terms conditional about AI and payments", async () => {
    const { default: TermsPage } = await import("@/app/terms/page");

    const markup = renderToStaticMarkup(<TermsPage />);
    const lower = markup.toLowerCase();

    expect(markup).toContain("Pilot terms");
    expect(markup).toContain("Optional AI results");
    expect(markup).toContain("Paid functionality is available only when it is enabled");
    expect(markup).toContain("does not purchase AI access, create a prepaid balance");
    expect(markup).toContain("Teachers remain responsible for grading decisions");
    expect(markup).toContain('href="/privacy"');
    expect(markup).toContain("deleting an account is not yet a self-service feature");
    expect(lower).not.toContain("ferpa compliant");
    expect(lower).not.toContain("coppa compliant");
    expect(lower).not.toContain("district-approved");
  });

  it("keeps privacy, terms, and support links in the shared footer", async () => {
    const { default: SiteFooter } = await import("@/app/components/SiteFooter");

    const markup = renderToStaticMarkup(<SiteFooter />);

    expect(markup).toContain('aria-label="Legal and support links"');
    expect(markup).toContain('href="/privacy"');
    expect(markup).toContain('href="/terms"');
    expect(markup).toContain('href="/feedback"');
    expect(markup).toContain("mailto:davidsgarcia325@gmail.com");
    expect(markup).toContain("currently offered as a teacher pilot");
  });
});
