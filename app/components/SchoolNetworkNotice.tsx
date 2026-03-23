"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

type SchoolNetworkNoticeProps = {
  message: string;
  storageKey: string;
  className?: string;
};

export default function SchoolNetworkNotice({
  message,
  storageKey,
  className = "",
}: SchoolNetworkNoticeProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        setVisible(localStorage.getItem(storageKey) !== "dismissed");
      } catch {
        setVisible(true);
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [storageKey]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(storageKey, "dismissed");
    } catch {
      // Ignore storage issues on restrictive browsers.
    }
  }

  if (!visible) return null;

  return (
    <div className={`notice info network-notice ${className}`.trim()}>
      <p className="network-notice-copy">{message}</p>
      <button
        type="button"
        className="network-notice-dismiss"
        aria-label="Dismiss notice"
        onClick={dismiss}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
