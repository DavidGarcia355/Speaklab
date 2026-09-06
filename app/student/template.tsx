import StudentRouteWipe from "./StudentRouteWipe";

export default function StudentTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="student-motion-scope">
      <StudentRouteWipe />
      {children}
    </div>
  );
}
