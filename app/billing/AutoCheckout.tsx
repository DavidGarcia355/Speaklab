"use client";

import { useEffect, useRef } from "react";

export default function AutoCheckout() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout")) return;

    void (async () => {
      try {
        const response = await fetch("/api/billing/checkout", { method: "POST" });
        const body = (await response.json()) as { url?: string };
        if (response.ok && body.url) window.location.assign(body.url);
      } catch {
        // BillingPanel below will show the actionable error/state.
      }
    })();
  }, []);

  return null;
}
