"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import BrandBar from "@/app/components/BrandBar";
import GoogleSignInLink from "@/app/components/GoogleSignInLink";
import PageTitle from "@/app/components/PageTitle";

type RegistrationState = "checking" | "available" | "invite-only" | "signed-out";

export default function TeacherRegisterPage() {
  const router = useRouter();
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [registrationState, setRegistrationState] = useState<RegistrationState>("checking");

  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      try {
        const response = await fetch("/api/auth/role", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) {
            setRegistrationState(response.status === 401 ? "signed-out" : "invite-only");
          }
          return;
        }
        const data = (await response.json()) as {
          role?: string;
          teacherRegistrationAvailable?: boolean;
        };
        if (!cancelled && data.role === "teacher") {
          router.replace("/teacher");
          router.refresh();
          return;
        }
        if (!cancelled) {
          setRegistrationState(data.teacherRegistrationAvailable ? "available" : "invite-only");
        }
      } catch {
        if (!cancelled) setRegistrationState("invite-only");
      }
    }

    void loadRole();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function registerTeacher() {
    setSaving(true);
    setErrorMsg("");

    try {
      const response = await fetch("/api/auth/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "teacher" }),
      });
      const data = (await response.json()) as { error?: string; role?: string };

      if (!response.ok) {
        throw new Error(data.error || "Unable to update your role.");
      }

      router.push("/teacher");
      router.refresh();
    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : "Unable to set up your teacher account right now."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page-wrap">
      <PageTitle title="Teacher Account Setup" />
      <BrandBar label="Teacher Registration" />
      <section className="hero">
        <p className="pill">Teacher setup</p>
        <h1>Request or activate teacher access</h1>
        <p>Create classes, share speaking prompts, and review recordings in one classroom workspace.</p>
      </section>

      <section className="card form-shell panel-subtle section-gap">
        <h2 className="surface-title">
          {registrationState === "available" ? "Your teacher access is ready" : "Teacher access is invite-only"}
        </h2>
        <p className="meta">
          {registrationState === "available"
            ? "Your signed-in account is approved. Activate it to open the teacher dashboard."
            : registrationState === "checking"
              ? "Checking whether your signed-in account is approved for the current pilot."
              : registrationState === "signed-out"
                ? "Sign in to check whether your account is already approved, or request a place in the current pilot."
                : "Habla is adding teachers through a reviewed pilot while privacy and district materials are finalized."}
        </p>
        {errorMsg ? <p className="notice danger">{errorMsg}</p> : null}
        <div className="actions form-actions">
          {registrationState === "available" ? (
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void registerTeacher()}
              disabled={saving}
            >
              {saving ? "Activating..." : "Activate teacher access"}
            </button>
          ) : registrationState === "checking" ? (
            <button className="btn btn-primary" type="button" disabled>
              Checking account...
            </button>
          ) : (
            <a className="btn btn-primary" href="/feedback">
              Request teacher pilot access
            </a>
          )}
        </div>
        <div className="actions" style={{ marginTop: "0.5rem" }}>
          <GoogleSignInLink className="btn btn-ghost" callbackUrl="/teacher/register">
            {registrationState === "signed-out" ? "Sign in to check access" : "Use another Google account"}
          </GoogleSignInLink>
        </div>
      </section>
    </main>
  );
}
