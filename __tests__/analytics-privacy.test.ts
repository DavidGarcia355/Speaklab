import { describe, expect, it } from "vitest";
import {
  analyticsDestination,
  normalizeAnalyticsPath,
} from "@/lib/analytics";

describe("analytics privacy boundary", () => {
  it("allows only the intended acquisition and billing pages", () => {
    expect(normalizeAnalyticsPath("/")).toBe("/");
    expect(normalizeAnalyticsPath("/teachers")).toBe("/teachers");
    expect(normalizeAnalyticsPath("/teacher/register")).toBe("/teacher/register");
    expect(normalizeAnalyticsPath("/pricing/")).toBe("/pricing");
    expect(normalizeAnalyticsPath("/billing")).toBe("/billing");
    expect(normalizeAnalyticsPath("/feedback")).toBe("/feedback");
  });

  it("excludes classroom, student, assignment, admin, and API routes", () => {
    expect(normalizeAnalyticsPath("/student")).toBeNull();
    expect(normalizeAnalyticsPath("/student/dashboard")).toBeNull();
    expect(normalizeAnalyticsPath("/teacher")).toBeNull();
    expect(normalizeAnalyticsPath("/teacher/class/abc")).toBeNull();
    expect(normalizeAnalyticsPath("/a/assignment-id")).toBeNull();
    expect(normalizeAnalyticsPath("/admin")).toBeNull();
    expect(normalizeAnalyticsPath("/api/submissions")).toBeNull();
  });

  it("records destinations without query strings or personal URL data", () => {
    expect(
      analyticsDestination(
        "https://tryhabla.com/teacher/register?email=private@example.com",
        "https://tryhabla.com"
      )
    ).toBe("/teacher/register");
    expect(
      analyticsDestination("https://stripe.com/example?session=secret", "https://tryhabla.com")
    ).toBe("external:stripe.com");
    expect(
      analyticsDestination("mailto:someone@example.com", "https://tryhabla.com")
    ).toBe("mailto");
  });
});
