import { describe, expect, it } from "vitest";
import {
  flightPoint,
  motionLink,
  progressBeforeArrival,
  studentDestination,
  HOLD_PROGRESS,
  ANTICIPATION_MS,
  motionScore,
  LANDING_PROGRESS,
} from "../app/student/motion/contracts";

describe("student motion ownership", () => {
  it.each([
    "/",
    "/teacher",
    "/teacher/class/one",
    "/labs/hablaman",
    "/api/auth/signout",
    "/student/class/one/settings",
    "/a/one/audio",
  ])("does not own %s", (path) => {
    expect(studentDestination(path)).toBeNull();
  });
  it.each([
    ["/student", "recordings"],
    ["/student/dashboard", "classes"],
    ["/student/class/one", "assignments"],
    ["/a/one", "record"],
  ])("recognizes %s", (path, scene) => {
    expect(studentDestination(path)).toBe(scene);
  });
  it("leaves same-page, external, teacher and non-navigation links native", () => {
    for (const href of [
      "#grades",
      "/student?view=history",
      "https://external.example/student/dashboard",
      "/teacher",
      "mailto:teacher@example.com",
    ]) {
      expect(motionLink(href, "/student", "https://tryhabla.com")).toBeNull();
    }
    expect(
      motionLink(
        "/student/dashboard?from=recordings",
        "/student",
        "https://tryhabla.com",
      ),
    ).toBe("/student/dashboard");
  });
});

describe("student flight continuity", () => {
  it("keeps routine navigation lighter than the main flight", () => {
    const duration = (destination: Parameters<typeof motionScore>[0]) => {
      const score = motionScore(destination);
      return (
        score.anticipation + score.flight * LANDING_PROGRESS + score.landing
      );
    };
    expect(duration("classes")).toBeLessThan(1600);
    expect(duration("assignments")).toBeLessThan(1000);
    expect(duration("record")).toBeLessThan(duration("assignments"));
    expect(motionScore("record").arc).toBeLessThan(motionScore("classes").arc);
  });
  it("does not advance the flight while the original artwork anticipates", () => {
    expect(progressBeforeArrival(0)).toBe(0);
    expect(progressBeforeArrival(ANTICIPATION_MS)).toBe(0);
    expect(progressBeforeArrival(ANTICIPATION_MS + 1)).toBeLessThan(0.001);
  });
  it("holds an unfinished flight rather than reaching an unavailable destination", () => {
    expect(progressBeforeArrival(5000)).toBe(HOLD_PROGRESS);
    expect(progressBeforeArrival(-1)).toBe(0);
  });
  it.each([
    [1440, 900],
    [1280, 800],
    [1024, 768],
    [390, 844],
    [360, 800],
  ])("keeps the path inside %sx%s", (width, height) => {
    const start = { x: width - 200, y: 100, width: 130, height: 130 };
    const end = { x: width - 260, y: 160, width: 220, height: 180 };
    for (let i = 0; i <= 100; i++) {
      const point = flightPoint(start, end, i / 100, width, height);
      expect(point.x).toBeGreaterThanOrEqual(85);
      expect(point.x).toBeLessThanOrEqual(width - 85);
      expect(point.y).toBeGreaterThanOrEqual(100);
      expect(point.y).toBeLessThanOrEqual(height - 110);
    }
  });
});
