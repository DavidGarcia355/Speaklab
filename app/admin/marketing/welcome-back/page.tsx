import Link from "next/link";

import BrandBar from "@/app/components/BrandBar";
import PageTitle from "@/app/components/PageTitle";
import { requireAdminEmail } from "@/lib/admin";
import {
  getWelcomeBackCampaignPreview,
  WELCOME_BACK_SUBJECT,
  welcomeBackHtml,
} from "@/lib/marketing-email";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function WelcomeBackCampaignPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { allowed } = await requireAdminEmail();
  if (!allowed) {
    return (
      <main className="page-wrap">
        <PageTitle title="Marketing" />
        <BrandBar label="Admin" />
        <section className="panel">
          <h1>Admin access required</h1>
        </section>
      </main>
    );
  }

  const params = await searchParams;
  const sent = first(params.sent);
  const error = first(params.error);
  const preview = await getWelcomeBackCampaignPreview();
  const exampleHtml = welcomeBackHtml("https://tryhabla.com/unsubscribe?preview=1");

  return (
    <main className="page-wrap">
      <PageTitle title="Welcome-back campaign" />
      <BrandBar label="Admin" />

      <div style={{ marginBottom: 16 }}>
        <Link href="/admin">← Back to admin</Link>
      </div>

      {sent ? (
        <section className="panel" style={{ marginBottom: 18 }}>
          <strong>Campaign sent to {sent} legacy teacher accounts.</strong>
        </section>
      ) : null}

      {error ? (
        <section className="panel" style={{ marginBottom: 18 }}>
          <strong>Send failed:</strong> {error}
        </section>
      ) : null}

      <section className="panel" style={{ marginBottom: 18 }}>
        <h1 style={{ marginTop: 0 }}>Review before sending</h1>
        <p><strong>Recipients:</strong> {preview.recipientCount} legacy teacher accounts</p>
        <p><strong>Cutoff:</strong> signed up before Aug. 21, 2026</p>
        <p><strong>From:</strong> {preview.from}</p>
        <p><strong>Subject:</strong> {WELCOME_BACK_SUBJECT}</p>
        <p style={{ marginBottom: 0 }}>
          Every recipient gets an individual email and a unique signed unsubscribe link. Previously unsubscribed addresses and internal test accounts are excluded automatically.
        </p>
      </section>

      <section className="panel" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Email preview</h2>
        <div
          style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", background: "white" }}
          dangerouslySetInnerHTML={{ __html: exampleHtml }}
        />
      </section>

      <section className="panel">
        <form action="/api/admin/marketing/welcome-back" method="post">
          <input type="hidden" name="confirmation" value="SEND_WELCOME_BACK_2026" />
          <button type="submit" className="btn btn-primary">
            Send to {preview.recipientCount} legacy teachers
          </button>
        </form>
      </section>
    </main>
  );
}
