import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";

export default function UnauthorizedPage() {
  return (
    <main className="page-wrap">
      <BrandBar label="Access" />
      <section className="hero">
        <p className="pill">Access needed</p>
        <h1>This page is for teachers.</h1>
        <p>
          If you&apos;re setting up your account, you&apos;ll need your access code.
        </p>
        <div className="actions form-actions">
          <Link className="btn btn-primary" href="/onboarding">
            Go to onboarding
          </Link>
        </div>
      </section>
    </main>
  );
}
