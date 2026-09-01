import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  listEnrolledClassesWithAssignmentsByEmail: vi.fn(),
  listSubmissionsByStudentEmail: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  listEnrolledClassesWithAssignmentsByEmail:
    mocks.listEnrolledClassesWithAssignmentsByEmail,
  listSubmissionsByStudentEmail: mocks.listSubmissionsByStudentEmail,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
  usePathname: () => "/student/dashboard",
}));

import StudentClassesPage from "@/app/student/dashboard/page";
import StudentClassPage from "@/app/student/class/[classId]/page";

describe("student workspace navigation", () => {
  beforeEach(() => {
    mocks.getServerSession.mockReset().mockResolvedValue({
      user: {
        email: "teacher@example.com",
        name: "Teacher",
        role: "teacher",
      },
    });
    mocks.listEnrolledClassesWithAssignmentsByEmail.mockReset().mockResolvedValue([]);
    mocks.listSubmissionsByStudentEmail.mockReset().mockResolvedValue([]);
    mocks.redirect.mockReset();
    mocks.notFound.mockReset();
  });

  it("links My Classes from recordings to the student classes route", () => {
    const source = readFileSync("app/student/page.tsx", "utf8");

    expect(source).toMatch(/href="\/student\/dashboard">My Classes<\/Link>/);
    expect(source).not.toMatch(/href="\/teacher(?:\/[^\"]*)?">My Classes<\/Link>/);
  });

  it("keeps a teacher-role account in the explicitly selected student classes workspace", async () => {
    const markup = renderToStaticMarkup(await StudentClassesPage());

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.listEnrolledClassesWithAssignmentsByEmail).toHaveBeenCalledWith(
      "teacher@example.com",
    );
    expect(markup).toContain("My Classes");
    expect(markup).not.toContain('href="/teacher"');
  });

  it("keeps the same account in an enrolled student class", async () => {
    mocks.listEnrolledClassesWithAssignmentsByEmail.mockResolvedValue([
      {
        classId: "class_1",
        className: "Student Spanish",
        assignmentId: null,
        assignmentTitle: null,
        maxPoints: 0,
        submissionCount: 0,
      },
    ]);

    const markup = renderToStaticMarkup(
      await StudentClassPage({ params: Promise.resolve({ classId: "class_1" }) }),
    );

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.listEnrolledClassesWithAssignmentsByEmail).toHaveBeenCalledWith(
      "teacher@example.com",
    );
    expect(mocks.listSubmissionsByStudentEmail).toHaveBeenCalledWith("teacher@example.com");
    expect(markup).toContain("Student Spanish");
    expect(markup).toContain('href="/student/dashboard"');
  });
});
