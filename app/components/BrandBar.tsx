"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import ThemeToggle from "@/app/components/ThemeToggle";
import BeltMark from "@/app/components/BeltMark";
import { APP_NAME } from "@/app/constants";

type BrandBarProps = {
  label?: string;
};

export default function BrandBar({ label }: BrandBarProps) {
  const pathname = usePathname();
  const [showTeacherPrompt, setShowTeacherPrompt] = useState(false);
  const [authenticatedRole, setAuthenticatedRole] = useState<"teacher" | "student" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      try {
        const response = await fetch("/api/auth/role", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) {
            setShowTeacherPrompt(false);
            setAuthenticatedRole(null);
          }
          return;
        }
        const data = (await response.json()) as {
          role?: string;
          teacherRegistrationAvailable?: boolean;
        };
        if (!cancelled) {
          setAuthenticatedRole(data.role === "teacher" || data.role === "student" ? data.role : null);
          setShowTeacherPrompt(
            data.role === "student" &&
              data.teacherRegistrationAvailable === true &&
              pathname !== "/teacher/register"
          );
        }
      } catch {
        if (!cancelled) {
          setShowTeacherPrompt(false);
          setAuthenticatedRole(null);
        }
      }
    }

    void loadRole();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const showTeacherSignOut =
    authenticatedRole === "teacher" &&
    (pathname === "/billing" || pathname === "/teacher" || pathname.startsWith("/teacher/"));

  return (
    <>
      <header className="brand-bar">
        <Link href="/" className="brand-link" aria-label={`${APP_NAME} home`}>
          <span className="brand-mark" aria-hidden="true">
            <BeltMark className="brand-belt-mark" />
          </span>
          <span className="brand-text">{APP_NAME}</span>
        </Link>
        <div className="brand-bar-right">
          {label ? <span className="brand-context">{label}</span> : null}
          {showTeacherSignOut ? (
            <Link className="btn btn-ghost btn-sm" href="/api/auth/signout?callbackUrl=/">
              Sign out
            </Link>
          ) : null}
          <ThemeToggle />
        </div>
      </header>
      {showTeacherPrompt ? (
        <div className="notice info teacher-access-notice">
          Are you a teacher?{" "}
          <Link className="teacher-access-link" href="/teacher/register">
            Activate approved access
          </Link>
        </div>
      ) : null}
    </>
  );
}
