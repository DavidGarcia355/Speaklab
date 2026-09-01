import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const classWorkspaceSource = readFileSync("app/teacher/class/[classId]/page.tsx", "utf8");
const teacherDashboardSource = readFileSync("app/teacher/page.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");

describe("teacher workspace UX safeguards", () => {
  it("keeps class and grading disclosure menus clear and above neighboring panels", () => {
    expect(classWorkspaceSource).toContain("More actions");
    expect(classWorkspaceSource).toContain("Download options");
    expect(classWorkspaceSource.match(/workspace-more-chevron/g)?.length).toBeGreaterThanOrEqual(2);
    expect(styles).toMatch(/\.route-stage-teacher \.teacher-class-header\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?z-index:\s*20;[\s\S]*?overflow:\s*visible;/);
    expect(styles).toMatch(/\.route-stage-teacher \.assignment-main\s*\{[\s\S]*?overflow:\s*visible;/);
    expect(styles).toMatch(/\.workspace-more-popover\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?z-index:\s*12;/);
    expect(styles.match(/overflow-x:\s*clip;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(styles).toContain("animation: fade-up 0.3s ease backwards;");
    expect(styles).toContain("animation: teacher-route-settle 180ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;");
    expect(styles).toMatch(/@keyframes fade-up\s*\{[\s\S]*?to\s*\{[^}]*transform:\s*none;/);
    expect(styles).toMatch(/@keyframes teacher-route-settle\s*\{[\s\S]*?to\s*\{[^}]*transform:\s*none;/);
    expect(styles).toMatch(/html\.dark \.btn-ghost:hover,[\s\S]*?background:\s*var\(--primary-soft\);[\s\S]*?color:\s*var\(--primary\);/);
  });

  it("uses correct invariant grading-count labels", () => {
    expect(classWorkspaceSource).toContain("{workspaceStats.pending} to grade");
    expect(classWorkspaceSource).toContain("`${assignment.ungradedCount} to grade`");
    expect(classWorkspaceSource).toContain("{activeAssignment.ungradedCount} ungraded");
    expect(teacherDashboardSource).toContain("`${status.pending} ungraded`");
    expect(classWorkspaceSource).not.toContain('pluralize(workspaceStats.pending, "to grade")');
    expect(classWorkspaceSource).not.toContain('pluralize(activeAssignment.ungradedCount, "ungraded")');
  });

  it("links tabs to their panels and supports standard keyboard navigation", () => {
    expect(classWorkspaceSource).toContain("onKeyDown={handleAssignmentTabKeyDown}");
    expect(classWorkspaceSource).toContain('aria-controls="assignment-review-panel"');
    expect(classWorkspaceSource).toContain('aria-controls="assignment-details-panel"');
    expect(classWorkspaceSource).toContain('aria-controls="assignment-share-panel"');
    expect(classWorkspaceSource).toContain('aria-labelledby="assignment-review-tab"');
    expect(classWorkspaceSource).toContain('aria-labelledby="assignment-details-tab"');
    expect(classWorkspaceSource).toContain('aria-labelledby="assignment-share-tab"');
    expect(classWorkspaceSource).toContain('event.key === "ArrowRight"');
  });
});
