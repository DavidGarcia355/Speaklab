"use client";

import { useEffect, useState, type ReactNode } from "react";
import { isInAppBrowser } from "@/lib/in-app-browser";

type SignInLinkProps = {
  callbackUrl: string;
  className: string;
  children: ReactNode;
  fallbackClassName?: string;
  wrapperClassName?: string;
  message?: string;
  openLabel?: string;
};

function joinClassNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export default function SignInLink({
  callbackUrl,
  className,
  children,
  fallbackClassName,
  wrapperClassName,
  message = "Open this page in a current standalone browser to sign in",
  openLabel = "Open in Chrome, Edge, Firefox, or Safari",
}: SignInLinkProps) {
  const [browserState, setBrowserState] = useState({
    blocked: false,
    currentUrl: callbackUrl,
  });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setBrowserState({
        blocked: isInAppBrowser(window.navigator.userAgent),
        currentUrl: window.location.href,
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [callbackUrl]);

  const signInHref = `/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  if (!browserState.blocked) {
    return (
      <a className={className} href={signInHref}>
        {children}
      </a>
    );
  }

  return (
    <div className={joinClassNames("auth-webview-guard", wrapperClassName)}>
      <span className={joinClassNames(className, "auth-webview-disabled")} aria-disabled="true">
        {children}
      </span>
      <p className="meta auth-webview-message" role="status">
        {message}
      </p>
      <a
        className={fallbackClassName ?? className}
        href={browserState.currentUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        {openLabel}
      </a>
    </div>
  );
}
