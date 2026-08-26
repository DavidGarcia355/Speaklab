"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import BrandBar from "@/app/components/BrandBar";
import SignInLink from "@/app/components/SignInLink";
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
        <h1>Set up your free teacher account</h1>
        <p>Create classes, share speaking prompts, and review recordings in one classroom workspace.</p>
      </section>

      <section className="card form-shell panel-subtle section-gap">
        <h2 className="surface-title">
          {registrationState === "available"
            ? "Create your teacher account"
            : registrationState === "checking"
              ? "Checking your account"
              : registrationState === "signed-out"
                ? "Sign in to start free"
                : "Teacher setup needs support"}
        </h2>
        <p className="meta">
          {registrationState === "available"
            ? "Continue to open your teacher dashboard. Core classroom features are free forever, and Free includes 30 successful AI reviews for the lifetime of your teacher account."
            : registrationState === "checking"
              ? "Checking whether teacher setup is available for your signed-in account."
              : registrationState === "signed-out"
                ? "Sign in to create your free teacher account and open the classroom workspace."
                : "Self-service teacher setup is unavailable for this account right now. Contact TryHabla support if you believe this is an error."}
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
              {saving ? "Creating..." : "Create teacher account"}
            </button>
          ) : registrationState === "checking" ? (
            <button className="btn btn-primary" type="button" disabled>
              Checking account...
            </button>
          ) : (
            <a className="btn btn-primary" href="/feedback">
              Contact support
            </a>
          )}
        </div>
        <div className="actions" style={{ marginTop: "0.5rem" }}>
          <SignInLink className="btn btn-ghost" callbackUrl="/teacher/register">
            {registrationState === "signed-out" ? "Sign in to start free" : "Use another account"}
          </SignInLink>
        </div>
      </section>
    </main>
  );
}
