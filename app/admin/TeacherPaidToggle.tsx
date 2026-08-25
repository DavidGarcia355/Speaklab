"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TeacherPaidToggle({
  email,
  isPaid,
}: {
  email: string;
  isPaid: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/teachers/${encodeURIComponent(email)}/paid`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaid: !isPaid }),
      });
      if (!response.ok) {
        throw new Error("Paid access did not update.");
      }
      router.refresh();
    } catch {
      setError("Retry");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className={`pill pill-button ${error ? "pill-warning" : isPaid ? "pill-success" : "pill-neutral"}`}
      onClick={() => void toggle()}
      disabled={pending}
      aria-label={isPaid ? `Revoke paid access for ${email}` : `Grant paid access to ${email}`}
      title={error || undefined}
    >
      {pending ? "Saving..." : error || (isPaid ? "Paid access" : "Grant access")}
    </button>
  );
}
