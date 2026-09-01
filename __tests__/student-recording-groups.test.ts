import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { groupStudentRecordingsByClass } from "@/lib/student-recording-groups";

describe("student recording class grouping", () => {
  it("keeps distinct classes separate when their display names match", () => {
    const assignments = [
      {
        classId: "class_alpha",
        className: "Spanish 1",
        assignmentId: "assignment_alpha",
        assignmentTitle: "Introductions",
        maxPoints: 10,
      },
      {
        classId: "class_beta",
        className: "Spanish 1",
        assignmentId: "assignment_beta",
        assignmentTitle: "Weekend recap",
        maxPoints: 20,
      },
    ];
    const submissions = assignments.map((assignment, index) => ({
      ...assignment,
      id: `submission_${index}`,
    }));

    const groups = groupStudentRecordingsByClass(assignments, submissions);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.classId)).toEqual(["class_alpha", "class_beta"]);
    expect(groups.map((group) => group.className)).toEqual(["Spanish 1", "Spanish 1"]);
    expect(groups[0]?.assignments[0]?.submissions[0]?.id).toBe("submission_0");
    expect(groups[1]?.assignments[0]?.submissions[0]?.id).toBe("submission_1");
  });

  it("uses stable class identity for the rendered group key", () => {
    const source = readFileSync("app/student/page.tsx", "utf8");

    expect(source).toContain("key={group.classId}");
    expect(source).not.toContain("key={group.className}");
  });
});
