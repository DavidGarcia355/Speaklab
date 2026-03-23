"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

type ExternalBrowserNoticeProps = {
  className?: string;
};

export default function ExternalBrowserNotice({ className = "" }: ExternalBrowserNoticeProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const urlParams = new URLSearchParams(window.location.search);
      setVisible(urlParams.get("auth") === "external-browser-required");
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  function dismiss() {
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className={`notice warning network-notice external-browser-notice ${className}`.trim()}>
      <p className="network-notice-copy external-browser-notice-copy">
        <strong>Sign-in requires an external browser.</strong> Facebook and other in-app browsers block Google sign-in for security. Please open this page in Safari or Chrome to continue.
      </p>
      <button
        type="button"
        className="network-notice-dismiss external-browser-notice-dismiss"
        aria-label="Dismiss notice"
        onClick={dismiss}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}