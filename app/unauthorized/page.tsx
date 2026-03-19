import type { Metadata } from "next";
import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";

export const metadata: Metadata = {
  title: "Teacher Access Required — Habla",
};

export default function UnauthorizedPage() {
  return (
    <main className="page-wrap">
      <BrandBar label="Access" />
      <section className="hero">
        <p className="pill">Access needed</p>
        <h1>This page is for teachers.</h1>
        <p>Sign in with your school account to open your teacher dashboard.</p>
        <div className="actions form-actions">
          <Link className="btn btn-primary" href="/api/auth/signin?callbackUrl=/teacher">
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
