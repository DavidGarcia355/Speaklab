"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BrandBar from "@/app/components/BrandBar";

type RoleResponse = {
  role?: "teacher" | "student";
};

export default function OnboardingPage() {
  const router = useRouter();
  const [loadingRole, setLoadingRole] = useState(true);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function checkRole() {
      try {
        const response = await fetch("/api/auth/role", { cache: "no-store" });
        if (response.status === 401) {
          router.replace("/api/auth/signin?callbackUrl=/onboarding");
          return;
        }
        if (!response.ok) {
          throw new Error("Unable to verify your account.");
        }
        const data = (await response.json()) as RoleResponse;
        if (!cancelled && data.role === "teacher") {
          router.replace("/teacher");
          return;
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMsg(error instanceof Error ? error.message : "Something went wrong — try refreshing the page.");
        }
      } finally {
        if (!cancelled) setLoadingRole(false);
      }
    }
    checkRole();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function redeemCode() {
    const cleanCode = code.trim();
    if (!cleanCode) {
      setErrorMsg("Please enter your access code.");
      return;
    }

    setSubmitting(true);
    setErrorMsg("");
    try {
      const response = await fetch("/api/onboarding/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleanCode }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Something went wrong — try refreshing the page.");
      }
      router.replace("/teacher");
    } catch (error) {
      setErrorMsg(
        error instanceof Error
          ? error.message
          : "That code didn't work — double-check it and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-wrap">
      <BrandBar label="Teacher Setup" />

      <section className="hero">
        <p className="pill">Welcome</p>
        <h1>Set up your teacher account</h1>
        <p>To set up your teacher account, enter the access code you were given.</p>
      </section>

      <section className="card form-shell section-gap">
        {loadingRole ? (
          <p className="meta">Checking your account…</p>
        ) : (
          <div className="grid">
            <div>
              <label className="label" htmlFor="onboarding-code">
                Access code
              </label>
              <input
                id="onboarding-code"
                className="input"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Enter your code"
                maxLength={80}
                autoComplete="one-time-code"
              />
            </div>

            {errorMsg ? <p className="card-inline-error">{errorMsg}</p> : null}

            <div className="actions form-actions">
              <button className="btn btn-primary" type="button" onClick={redeemCode} disabled={submitting}>
                {submitting ? "Setting up..." : "Continue"}
              </button>
              <Link className="btn btn-ghost" href="/">
                Back Home
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
