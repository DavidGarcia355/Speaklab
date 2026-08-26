import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Teacher Pilot Access",
  robots: { index: false, follow: false },
};

export default function TeacherRegisterLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
