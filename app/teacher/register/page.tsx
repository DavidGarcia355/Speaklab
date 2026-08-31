"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import BrandBar from "@/app/components/BrandBar";
import ExternalBrowserNotice from "@/app/components/ExternalBrowserNotice";
import SignInLink from "@/app/components/SignInLink";
import PageTitle from "@/app/components/PageTitle";
import { SITE_URL } from "@/app/constants";
import {
  buildTeacherRegistrationCallbackUrl,
  teacherReturnPathFromSearch,
} from "@/lib/teacher-registration-return";

type RegistrationState =
  | "checking"
  | "available"
  | "invite-only"
  | "signed-out"
  | "unavailable";

export default function TeacherRegisterPage() {
  const router = useRouter();
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [registrationState, setRegistrationState] = useState<RegistrationState>("checking");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [teacherReturnPath, setTeacherReturnPath] = useState("/teacher");

  useEffect(() => {
    let cancelled = false;
    const requestedTeacherReturnPath = teacherReturnPathFromSearch(window.location.search);
    setTeacherReturnPath(requestedTeacherReturnPath);

    async function loadRole() {
      try {
        const response = await fetch("/api/auth/role", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) {
            setRegistrationState(response.status === 401 ? "signed-out" : "unavailable");
          }
          return;
        }
        const data = (await response.json()) as {
          role?: string;
          teacherRegistrationAvailable?: boolean;
        };
        if (!cancelled && data.role === "teacher") {
          router.replace(requestedTeacherReturnPath);
          router.refresh();
          return;
        }
        if (!cancelled) {
          setRegistrationState(data.teacherRegistrationAvailable ? "available" : "invite-only");
        }
      } catch {
        if (!cancelled) setRegistrationState("unavailable");
      }
    }

    void loadRole();
    return () => {
      cancelled = true;
    };
  }, [checkAttempt, router]);

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

      router.push(teacherReturnPath);
      router.refresh();
    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : "Unable to set up your teacher account right now."
      );
    } finally {
      setSaving(false);
    }
  }

  const signInCallbackUrl = buildTeacherRegistrationCallbackUrl(teacherReturnPath);

  return (
    <main className="page-wrap">
      <PageTitle title="Teacher Account Setup" />
      <BrandBar label="Teacher Registration" />
      <ExternalBrowserNotice />
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
                : registrationState === "unavailable"
                  ? "We could not check teacher setup"
                : "Teacher setup needs support"}
        </h2>
        <p className="meta">
          {registrationState === "available"
            ? "Continue to open your teacher dashboard. Core classroom features are free forever, and Free includes 30 AI-assisted recordings for the lifetime of your teacher account."
            : registrationState === "checking"
              ? "Checking whether teacher setup is available for your signed-in account."
              : registrationState === "signed-out"
                ? "Sign in to create your free teacher account and open the classroom workspace."
                : registrationState === "unavailable"
                  ? "The account check did not finish. This may be temporary, so retry before contacting support."
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
          ) : registrationState === "unavailable" ? (
            <>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  setRegistrationState("checking");
                  setCheckAttempt((value) => value + 1);
                }}
              >
                Retry account check
              </button>
              <a
                className="btn btn-ghost"
                href="/feedback?intent=auth&authError=RegistrationCheckFailed&from=%2Fteacher%2Fregister"
              >
                Contact support
              </a>
            </>
          ) : registrationState === "signed-out" ? (
            <SignInLink
              className="btn btn-primary"
              callbackUrl={signInCallbackUrl}
              externalBrowserUrl={`${SITE_URL}${signInCallbackUrl}`}
              message="Google sign-in cannot open inside Facebook or another app's browser."
              externalBrowserInstructions="Tap the menu in this app → Open in browser. Then sign in to create your free teacher account."
            >
              Sign in to start free
            </SignInLink>
          ) : (
            <a
              className="btn btn-primary"
              href="/feedback?intent=auth&authError=RegistrationClosed&from=%2Fteacher%2Fregister"
            >
              Contact support
            </a>
          )}
        </div>
        {registrationState !== "signed-out" && registrationState !== "checking" ? (
          <div className="actions" style={{ marginTop: "0.5rem" }}>
            <SignInLink
              className="btn btn-ghost"
              callbackUrl={signInCallbackUrl}
              externalBrowserUrl={`${SITE_URL}${signInCallbackUrl}`}
              message="Google sign-in cannot open inside Facebook or another app's browser."
              externalBrowserInstructions="Tap the menu in this app → Open in browser. Then sign in to create your free teacher account."
            >
              Use another account
            </SignInLink>
          </div>
        ) : null}
      </section>
    </main>
  );
}
