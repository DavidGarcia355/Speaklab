"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ConfirmModal from "@/app/components/ConfirmModal";

export default function DeleteFeedbackButton({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    setConfirming(false);
    await fetch(`/api/admin/feedback/${messageId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setConfirming(true)}
        aria-label="Delete message"
      >
        Delete
      </button>
      <ConfirmModal
        open={confirming}
        title="Delete message"
        description="This will permanently delete this contact message. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
