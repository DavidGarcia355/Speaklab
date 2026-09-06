import "server-only";
import { findClassById, isStudentOnRoster } from "./db";
import { HttpError } from "./http";
import { enforceStudentAssignmentAccessPolicy } from "./student-assignment-access";

export async function requireStudentPracticeClass(classId: string, studentEmail: string) {
  const classroom = await findClassById(classId);
  if (!classroom || !(await isStudentOnRoster(classId, studentEmail))) throw new HttpError(403, "Open Mic is available only for your enrolled classes.");
  await enforceStudentAssignmentAccessPolicy({ classId, studentEmail, ownerEmail: classroom.ownerEmail });
  return classroom;
}
