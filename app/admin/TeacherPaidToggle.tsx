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

  async function toggle() {
    setPending(true);
    try {
      await fetch(`/api/admin/teachers/${encodeURIComponent(email)}/paid`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaid: !isPaid }),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className={`pill pill-button ${isPaid ? "pill-success" : "pill-neutral"}`}
      onClick={() => void toggle()}
      disabled={pending}
      aria-label={isPaid ? `Revoke AI grading access for ${email}` : `Grant AI grading access to ${email}`}
    >
      {pending ? "..." : isPaid ? "Pilot grant" : "No grant"}
    </button>
  );
}
