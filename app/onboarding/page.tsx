import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";

export default function OnboardingPage() {
  return (
    <main className="page-wrap">
      <BrandBar label="Teacher Access" />
      <section className="hero">
        <p className="pill">Teacher Studio</p>
        <h1>Sign in with Google to continue</h1>
        <p>
          Teacher access is automatic now. Once you sign in, you&apos;ll go straight to your dashboard.
        </p>
        <div className="actions form-actions">
          <Link className="btn btn-primary" href="/api/auth/signin/google?callbackUrl=/teacher">
            Sign in with Google
          </Link>
          <Link className="btn btn-ghost" href="/">
            Back Home
          </Link>
        </div>
      </section>
    </main>
  );
}
