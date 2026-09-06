import StudentAssignmentClient from "@/app/a/[assignmentId]/student-assignment-client";

export default async function OpenMicPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const localAuthBypassEnabled = process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_BYPASS_AUTH === "true";
  // The form loads class information only through the authenticated, roster-scoped API.
  return <StudentAssignmentClient assignmentId="" practiceClassId={classId} localAuthBypassEnabled={localAuthBypassEnabled} />;
}
