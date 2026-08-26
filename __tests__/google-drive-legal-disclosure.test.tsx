import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("Google Drive export legal disclosure", () => {
  it("describes the limited, user-directed export and independent retention", async () => {
    const [{ default: PrivacyPage }, { default: TermsPage }] = await Promise.all([
      import("@/app/privacy/page"),
      import("@/app/terms/page"),
    ]);

    const copy = `${renderToStaticMarkup(<PrivacyPage />)} ${renderToStaticMarkup(<TermsPage />)}`;

    expect(copy).toContain("user-directed");
    expect(copy).toContain("drive.file");
    expect(copy).toContain("does not give TryHabla permission to read the user&#x27;s entire Drive");
    expect(copy).toContain("held only in browser memory");
    expect(copy).toContain("does not store a Google Drive refresh token");
    expect(copy).toContain("Deleting the related content from TryHabla does not delete");
    expect(copy).toContain("does not promise permanent storage");
  });
});
