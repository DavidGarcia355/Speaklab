import PracticeInbox from "./PracticeInbox";

export default async function PracticePage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  return <PracticeInbox classId={classId} />;
}
