"use client";

import { FormEvent, useState } from "react";

export default function UnsubscribePage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setError("");

    try {
      const response = await fetch("/api/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to unsubscribe.");
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to unsubscribe.");
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16">
      <section className="w-full rounded-2xl border border-black/10 bg-white p-8 shadow-sm">
        <a href="/" className="text-xl font-semibold tracking-tight text-black">
          TryHabla
        </a>

        {status === "done" ? (
          <div className="mt-8">
            <h1 className="text-2xl font-semibold text-black">You're unsubscribed.</h1>
            <p className="mt-3 text-sm leading-6 text-black/65">
              You won't receive future TryHabla product and update emails at that address.
            </p>
          </div>
        ) : (
          <>
            <h1 className="mt-8 text-2xl font-semibold text-black">Unsubscribe from TryHabla updates</h1>
            <p className="mt-3 text-sm leading-6 text-black/65">
              Enter the email address that received the message. We'll remove it from future product and update emails.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block text-sm font-medium text-black" htmlFor="email">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-black/15 px-4 py-3 text-black outline-none focus:border-black"
                placeholder="you@school.org"
              />
              {status === "error" && <p className="text-sm text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={status === "saving"}
                className="w-full rounded-xl bg-black px-4 py-3 font-medium text-white disabled:opacity-60"
              >
                {status === "saving" ? "Unsubscribing..." : "Unsubscribe"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
