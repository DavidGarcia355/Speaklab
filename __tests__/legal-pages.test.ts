import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("public legal terminology and safeguards", () => {
  it("keeps the Privacy Notice substantive disclosures while removing pilot branding", async () => {
    const { default: PrivacyPage, metadata } = await import("@/app/privacy/page");

    const markup = renderToStaticMarkup(PrivacyPage());
    const publicCopy = `${metadata.title} ${metadata.description} ${markup}`;

    expect(publicCopy).toContain("Privacy Notice");
    expect(markup).toContain("It is not a claim that a school or district has approved TryHabla");
    expect(markup).toContain("audio recording");
    expect(markup).toContain("recorded answer, transcript, assignment");
    expect(markup).toContain("production service identifies OpenAI");
    expect(markup).toContain("TryHabla does not promise a particular provider retention mode");
    expect(markup).toContain("30-day recovery period");
    expect(markup).toContain("No online service can guarantee absolute security");
    expect(markup).toContain("A public TryHabla page does not establish district approval");
    expect(publicCopy).not.toMatch(/teacher pilot|school pilot/i);
  });

  it("keeps Terms pricing, school boundaries, and reliability caveats without pilot branding", async () => {
    const { default: TermsPage, metadata } = await import("@/app/terms/page");

    const markup = renderToStaticMarkup(TermsPage());
    const publicCopy = `${metadata.title} ${metadata.description} ${markup}`;

    expect(publicCopy).toContain("Terms of Use");
    expect(markup).toContain("They are not a statement that any school or district has approved TryHabla");
    expect(markup).toContain("Free includes one lifetime allowance of 30 successful AI reviews");
    expect(markup).toContain("Teacher costs $20 per month");
    expect(markup).toContain("300 successful AI reviews in each Stripe billing period");
    expect(markup).toContain("neither option has automatic overages");
    expect(markup).toContain("recording, playback, and manual grading remain available");
    expect(markup).toContain("TryHabla for Schools is a contact-based option");
    expect(markup).toContain("does not promise a school administrator console");
    expect(markup).toContain("consolidated school billing, or district approval");
    expect(markup).toContain("A PayPal donation does not purchase TryHabla");
    expect(markup).toContain("early-stage service and may contain errors or experience interruptions");
    expect(markup).toContain("No online service or AI output is guaranteed");
    expect(publicCopy).not.toMatch(/teacher pilot|school pilot/i);
  });
});
