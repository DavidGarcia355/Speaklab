import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const publicAndShellFiles = [
  "app/page.tsx",
  "app/about/page.tsx",
  "app/auth/error/page.tsx",
  "app/billing/page.tsx",
  "app/billing/BillingPanel.tsx",
  "app/changelog/page.tsx",
  "app/district/page.tsx",
  "app/faq/page.tsx",
  "app/feedback/page.tsx",
  "app/pricing/page.tsx",
  "app/privacy/page.tsx",
  "app/students/page.tsx",
  "app/teachers/page.tsx",
  "app/terms/page.tsx",
  "app/unauthorized/page.tsx",
  "app/unsubscribe/page.tsx",
  "app/components/AudienceHero.tsx",
  "app/components/BrandBar.tsx",
  "app/components/DismissibleCauseBand.tsx",
  "app/components/SiteFooter.tsx",
] as const;

const implementedPageRoutes = new Set([
  "/",
  "/about",
  "/auth/error",
  "/billing",
  "/changelog",
  "/district",
  "/faq",
  "/feedback",
  "/pricing",
  "/privacy",
  "/student",
  "/student/dashboard",
  "/students",
  "/teacher",
  "/teacher/register",
  "/teachers",
  "/terms",
  "/unauthorized",
  "/unsubscribe",
]);

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

describe("public routes and shared shell integrity", () => {
  it("keeps literal internal navigation pointed at implemented pages", () => {
    for (const file of publicAndShellFiles) {
      const source = readFileSync(file, "utf8");
      const destinations = [...source.matchAll(/\b(?:href|callbackUrl)="(\/[^"#?]*)/g)]
        .map((match) => match[1])
        .filter((path) => !path.startsWith("/api/"));

      for (const destination of destinations) {
        expect(
          implementedPageRoutes.has(destination),
          `${file} links to missing internal page ${destination}`
        ).toBe(true);
      }
    }
  });

  it("keeps public bitmap and SVG references tracked with exact-case paths", () => {
    const trackedAssets = new Set(
      listFiles("public").map((file) => `/${relative("public", file).split(sep).join("/")}`)
    );

    for (const file of publicAndShellFiles) {
      const source = readFileSync(file, "utf8");
      const assetPaths = [...source.matchAll(/\b(?:src|artSrc)="(\/[A-Za-z0-9_./-]+\.(?:ico|png|svg|webp))"/g)]
        .map((match) => match[1]);

      for (const assetPath of assetPaths) {
        expect(trackedAssets.has(assetPath), `${file} references missing asset ${assetPath}`).toBe(true);
      }
    }
  });

  it("keeps auth errors private in metadata and feedback errors screen-reader connected", () => {
    const authErrorSource = readFileSync("app/auth/error/page.tsx", "utf8");
    expect(authErrorSource).toContain('title: "Sign-in Help"');
    expect(authErrorSource).toContain("robots: { index: false, follow: false }");

    const feedbackSource = readFileSync("app/feedback/page.tsx", "utf8");
    for (const field of ["name", "email", "school", "role", "message"]) {
      expect(feedbackSource).toContain(`aria-describedby={fieldErrors.${field}?.[0] ? "${field}-error" : undefined}`);
      expect(feedbackSource).toContain(`id="${field}-error"`);
    }
    expect(feedbackSource).toContain('aria-busy={submitting}');
    expect(feedbackSource).toContain('role={status.startsWith("Thanks") ? "status" : "alert"}');
  });
});
