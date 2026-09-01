import StudentRouteWipe from "@/app/student/StudentRouteWipe";

export default function AssignmentTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="route-stage route-stage-student route-stage-assignment">
      <StudentRouteWipe />
      {children}
    </div>
  );
}
