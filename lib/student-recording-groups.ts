export type StudentRecordingAssignment = {
  classId: string;
  className: string;
  assignmentId: string;
  assignmentTitle: string;
  maxPoints: number;
};

export type StudentRecordingGroup<TSubmission extends StudentRecordingAssignment> = {
  classId: string;
  className: string;
  assignments: {
    assignmentId: string;
    assignmentTitle: string;
    maxPoints: number;
    submissions: TSubmission[];
  }[];
};

export function groupStudentRecordingsByClass<
  TSubmission extends StudentRecordingAssignment,
>(
  assignments: readonly StudentRecordingAssignment[],
  submissions: readonly TSubmission[],
): StudentRecordingGroup<TSubmission>[] {
  const classMap = new Map<
    string,
    {
      className: string;
      assignments: Map<
        string,
        {
          assignmentId: string;
          assignmentTitle: string;
          maxPoints: number;
          submissions: TSubmission[];
        }
      >;
      assignmentOrder: string[];
    }
  >();
  const classOrder: string[] = [];

  function ensureAssignment(item: StudentRecordingAssignment) {
    let classGroup = classMap.get(item.classId);
    if (!classGroup) {
      classGroup = {
        className: item.className,
        assignments: new Map(),
        assignmentOrder: [],
      };
      classMap.set(item.classId, classGroup);
      classOrder.push(item.classId);
    }

    let assignmentGroup = classGroup.assignments.get(item.assignmentId);
    if (!assignmentGroup) {
      assignmentGroup = {
        assignmentId: item.assignmentId,
        assignmentTitle: item.assignmentTitle,
        maxPoints: item.maxPoints,
        submissions: [],
      };
      classGroup.assignments.set(item.assignmentId, assignmentGroup);
      classGroup.assignmentOrder.push(item.assignmentId);
    }

    return assignmentGroup;
  }

  for (const assignment of assignments) ensureAssignment(assignment);

  for (const submission of submissions) {
    ensureAssignment(submission).submissions.push(submission);
  }

  return classOrder.map((classId) => {
    const classGroup = classMap.get(classId)!;
    return {
      classId,
      className: classGroup.className,
      assignments: classGroup.assignmentOrder.map(
        (assignmentId) => classGroup.assignments.get(assignmentId)!,
      ),
    };
  });
}
