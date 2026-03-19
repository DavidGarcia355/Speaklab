import StudentAssignmentClient from "@/app/a/[assignmentId]/student-assignment-client";

type StudentAssignmentPageProps = {
  params: Promise<{ assignmentId: string }>;
};

export default async function StudentAssignmentPage(props: StudentAssignmentPageProps) {
  const { assignmentId } = await props.params;
  const isDev = process.env.NODE_ENV !== "production";
  const bypassAuth = isDev && process.env.LOCAL_DEV_BYPASS_AUTH === "true";

  return (
    <StudentAssignmentClient
      assignmentId={assignmentId}
      localAuthBypassEnabled={bypassAuth}
    />
  );
}
