import Link from "next/link";

import { verifyMarketingUnsubscribeToken } from "@/lib/marketing-unsubscribe";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "your email address";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = first(params.status);

  if (status === "done") {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16">
        <section className="w-full rounded-2xl border border-black/10 bg-white p-8 shadow-sm">
          <Link href="/" className="text-xl font-semibold tracking-tight text-black">
            TryHabla
          </Link>
          <h1 className="mt-8 text-2xl font-semibold text-black">You’re unsubscribed.</h1>
          <p className="mt-3 text-sm leading-6 text-black/65">
            You won’t receive future TryHabla product and update emails.
          </p>
        </section>
      </main>
    );
  }

  const email = first(params.email).trim().toLowerCase();
  const token = first(params.token);
  const valid = verifyMarketingUnsubscribeToken(email, token);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16">
      <section className="w-full rounded-2xl border border-black/10 bg-white p-8 shadow-sm">
        <Link href="/" className="text-xl font-semibold tracking-tight text-black">
          TryHabla
        </Link>

        {valid ? (
          <>
            <h1 className="mt-8 text-2xl font-semibold text-black">Unsubscribe from TryHabla updates?</h1>
            <p className="mt-3 text-sm leading-6 text-black/65">
              This will stop product and update emails to {maskEmail(email)}. Your TryHabla account and classroom data are not affected.
            </p>
            <form
              action={`/api/email/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`}
              method="post"
              className="mt-6"
            >
              <input type="hidden" name="source" value="browser" />
              <button
                type="submit"
                className="w-full rounded-xl bg-black px-4 py-3 font-medium text-white"
              >
                Unsubscribe
              </button>
            </form>
            <Link href="/" className="mt-4 block text-center text-sm text-black/60 underline">
              Keep me subscribed
            </Link>
          </>
        ) : (
          <>
            <h1 className="mt-8 text-2xl font-semibold text-black">This unsubscribe link isn’t valid.</h1>
            <p className="mt-3 text-sm leading-6 text-black/65">
              Please use the unsubscribe link from the most recent TryHabla update email.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
