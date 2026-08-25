"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import ThemeToggle from "@/app/components/ThemeToggle";
import { APP_NAME } from "@/app/constants";

type BrandBarProps = {
  label?: string;
};

export default function BrandBar({ label }: BrandBarProps) {
  const pathname = usePathname();
  const [showTeacherPrompt, setShowTeacherPrompt] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      try {
        const response = await fetch("/api/auth/role", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) setShowTeacherPrompt(false);
          return;
        }
        const data = (await response.json()) as {
          role?: string;
          teacherRegistrationAvailable?: boolean;
        };
        if (!cancelled) {
          setShowTeacherPrompt(
            data.role === "student" &&
              data.teacherRegistrationAvailable === true &&
              pathname !== "/teacher/register"
          );
        }
      } catch {
        if (!cancelled) setShowTeacherPrompt(false);
      }
    }

    void loadRole();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <>
      <header className="brand-bar">
        <Link href="/" className="brand-link" aria-label={`${APP_NAME} home`}>
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-belt-mark">H</span>
          </span>
          <span className="brand-text">{APP_NAME}</span>
        </Link>
        <div className="brand-bar-right">
          {label ? <span className="brand-context">{label}</span> : null}
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
