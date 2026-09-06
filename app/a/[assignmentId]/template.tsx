import StudentRouteWipe from "@/app/student/StudentRouteWipe";

export default function AssignmentTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="student-motion-scope">
      <StudentRouteWipe />
      {children}
    </div>
  );
}
