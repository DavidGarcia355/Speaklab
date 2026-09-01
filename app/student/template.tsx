import StudentRouteWipe from "./StudentRouteWipe";

export default function StudentTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="route-stage route-stage-student">
      <StudentRouteWipe />
      {children}
    </div>
  );
}
