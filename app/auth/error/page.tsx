import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";
import PageTitle from "@/app/components/PageTitle";
import SignInLink from "@/app/components/SignInLink";
import { SITE_URL } from "@/app/constants";
import { logAuthDiagnostic } from "@/lib/auth-diagnostics";
import { normalizeAuthSupportCode } from "@/lib/auth-diagnostics-shared";
import { getAuthErrorCopy } from "@/lib/auth-error-copy";

type AuthErrorPageProps = {
  searchParams: Promise<{ error?: string | string[] }>;
};

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const code = normalizeAuthSupportCode((await searchParams).error);
  const copy = getAuthErrorCopy(code);
  logAuthDiagnostic("auth_error_presented", { code, route: "/auth/error" }, "warn");

  const supportUrl = `/feedback?intent=auth&authError=${encodeURIComponent(code)}&from=${encodeURIComponent("/auth/error")}`;

  return (
    <main className="page-wrap">
      <PageTitle title="Sign-in Help" />
      <BrandBar label="Sign-in Help" />
      <section className="hero">
        <p className="pill">Account access</p>
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
      </section>

      <section className="card form-shell panel-subtle section-gap">
        <p className="notice danger" role="alert">
          Sign-in reference: <strong>{code}</strong>
        </p>
        <p className="meta">
          Support receives this reference automatically when you use the contact link below. Do not
          send a password or verification code.
        </p>
        <div className="actions form-actions">
          <SignInLink
            className="btn btn-primary"
            callbackUrl="/teacher/register"
            externalBrowserUrl={`${SITE_URL}/teacher/register`}
          >
            Try sign-in again
          </SignInLink>
          <Link className="btn btn-ghost" href={supportUrl}>
            Contact support
          </Link>
        </div>
      </section>
    </main>
  );
}
