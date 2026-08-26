import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GoogleDriveExportButton from "@/app/components/GoogleDriveExportButton";

describe("Google Drive export button", () => {
  it("renders no broken control while public feature configuration is loading", () => {
    const markup = renderToStaticMarkup(
      <GoogleDriveExportButton
        submissionId="sub-123"
        studentName="Sandra Sosa"
        filenameBase="TryHabla - Sandra - Respuesta"
      />,
    );

    expect(markup).toBe("");
  });

  it("also hides the recording-only variant until the server confirms Drive is active", () => {
    const markup = renderToStaticMarkup(
      <GoogleDriveExportButton
        submissionId="sub-123"
        studentName="Sandra Sosa"
        filenameBase="TryHabla - Sandra - Respuesta"
        includeTranscript={false}
      />,
    );
    expect(markup).toBe("");
  });
});
