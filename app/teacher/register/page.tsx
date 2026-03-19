"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import BrandBar from "@/app/components/BrandBar";
import GoogleSignInLink from "@/app/components/GoogleSignInLink";
import PageTitle from "@/app/components/PageTitle";

export default function TeacherRegisterPage() {
  const router = useRouter();
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkingRole, setCheckingRole] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      try {
        const response = await fetch("/api/auth/role", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { role?: string };
        if (!cancelled && data.role === "teacher") {
          router.replace("/teacher");
          router.refresh();
        }
      } catch {
        // Keep the page usable even if the role check fails.
      } finally {
        if (!cancelled) setCheckingRole(false);
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
        <h1>Set up your teacher account</h1>
        <p>Upgrade your Habla account to create classes, share speaking prompts, and review recordings.</p>
      </section>

      <section className="card form-shell panel-subtle section-gap">
        <h2 className="surface-title">Ready to teach with Habla?</h2>
        <p className="meta">This takes one click and opens your teacher dashboard right away.</p>
        {errorMsg ? <p className="notice danger">{errorMsg}</p> : null}
        <div className="actions form-actions">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void registerTeacher()}
            disabled={saving || checkingRole}
          >
            {checkingRole ? "Checking account..." : saving ? "Setting up..." : "Get started as a teacher"}
          </button>
        </div>
        <p className="meta teacher-register-note">
          Already signed in? We&apos;ll take you straight into class setup after this step.
        </p>
        <div className="actions" style={{ marginTop: "0.5rem" }}>
          <GoogleSignInLink className="btn btn-ghost" callbackUrl="/teacher/register">
            Need to sign in first?
          </GoogleSignInLink>
        </div>
      </section>
    </main>
  );
}
