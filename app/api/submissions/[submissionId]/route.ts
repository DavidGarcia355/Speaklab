import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { deleteSubmission, findAssignmentById, findSubmissionById, updateSubmission } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { parseOrThrow400, submissionPatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ submissionId: string }> }
) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const { submissionId } = await context.params;
    const existing = await findSubmissionById(submissionId, teacherEmail);
    if (!existing) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }

    const body = parseOrThrow400(submissionPatchSchema, await request.json());
    const hasStudentName = typeof body.studentName !== "undefined";
    const hasGrade = Object.prototype.hasOwnProperty.call(body, "grade");
    const hasFeedback = typeof body.feedback !== "undefined";
    const hasRubricScores = Array.isArray(body.rubricScores);

    const studentName = hasStudentName ? body.studentName! : existing.studentName;
    let grade = hasGrade ? body.grade ?? null : existing.grade;
    const feedback = hasFeedback ? body.feedback ?? "" : existing.feedback;
    let rubricScores = hasRubricScores ? body.rubricScores! : existing.rubricScores;

    if (grade !== null || hasRubricScores) {
      const assignment = await findAssignmentById(existing.assignmentId, teacherEmail);
      if (!assignment) {
        return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
      }

      if (hasRubricScores) {
        if (!assignment.rubric) {
          throw new HttpError(400, "This assignment does not use rubric grading.");
        }
        const criteriaById = new Map(assignment.rubric.criteria.map((criterion) => [criterion.id, criterion]));
        if (body.rubricScores!.length !== assignment.rubric.criteria.length) {
          throw new HttpError(400, "Rubric scores must include every rubric criterion.");
        }
        rubricScores = body.rubricScores!.map((score) => {
          const criterion = criteriaById.get(score.criterionId);
          if (!criterion) {
            throw new HttpError(400, "Rubric score does not match this assignment.");
          }
          if (score.awarded > criterion.maxPoints) {
            throw new HttpError(400, `Criterion score must be between 0 and ${criterion.maxPoints}.`);
          }
          return {
            criterionId: criterion.id,
            criterionName: criterion.name,
            maxPoints: criterion.maxPoints,
            awarded: score.awarded,
          };
        });
        grade = rubricScores.reduce((sum, item) => sum + item.awarded, 0);
      }

      if (grade !== null && grade > assignment.maxPoints) {
        throw new HttpError(400, `Score must be between 0 and ${assignment.maxPoints}.`);
      }
    }

    if (!hasRubricScores && hasGrade) {
      rubricScores = null;
    }

    const updated = await updateSubmission(submissionId, teacherEmail, {
      studentName,
      grade,
      feedback,
      rubricScores,
    });
    if (!updated) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }
    return NextResponse.json({ item: updated });
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ submissionId: string }> }
) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const { submissionId } = await context.params;
    const existing = await findSubmissionById(submissionId, teacherEmail);
    if (!existing) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }

    const deleted = await deleteSubmission(submissionId, teacherEmail);
    if (!deleted) {
      return NextResponse.json({ error: "Unable to delete submission." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  });
}
