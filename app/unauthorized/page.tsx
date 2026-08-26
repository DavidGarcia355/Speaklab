import type { Metadata } from "next";
import BrandBar from "@/app/components/BrandBar";
import GoogleSignInLink from "@/app/components/GoogleSignInLink";

export const metadata: Metadata = {
  title: "Teacher Access Required",
  robots: { index: false, follow: false },
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
          <GoogleSignInLink className="btn btn-primary" callbackUrl="/teacher">
            Sign in
          </GoogleSignInLink>
        </div>
      </section>
    </main>
  );
}
