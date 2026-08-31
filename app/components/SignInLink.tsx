"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { isInAppBrowser } from "@/lib/in-app-browser";
import styles from "./SignInLink.module.css";

export type CopyLinkState = "idle" | "copying" | "copied" | "failed";

type ClipboardWriter = {
  writeText: (text: string) => Promise<void>;
};

type CopyDependencies = {
  clipboard?: ClipboardWriter;
  document?: Document;
};

type WebviewAuthEvent = "webview_help_shown" | "webview_link_copied";

type DiagnosticDependencies = {
  route?: string;
  fetch?: (input: string, init: RequestInit) => Promise<unknown>;
};

type SignInLinkProps = {
  callbackUrl: string;
  className: string;
  children: ReactNode;
  fallbackClassName?: string;
  wrapperClassName?: string;
  message?: string;
  externalBrowserInstructions?: string;
  externalBrowserUrl?: string;
  onWebviewHelpShown?: () => void;
  onCanonicalLinkCopied?: () => void;
};

type EmbeddedBrowserFallbackProps = Pick<
  SignInLinkProps,
  | "className"
  | "fallbackClassName"
  | "wrapperClassName"
  | "message"
  | "externalBrowserInstructions"
> & {
  children?: ReactNode;
  externalBrowserUrl: string;
  onCanonicalLinkCopied?: () => void;
};

const DEFAULT_MESSAGE = "Sign-in cannot open inside this app's browser.";
const DEFAULT_INSTRUCTIONS =
  "Tap the menu in this app → Open in browser. If that option is unavailable, copy the link below and paste it into your browser.";

function joinClassNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

/** Sends only the event name and path; failures never interrupt the sign-in escape flow. */
export function reportWebviewAuthEvent(
  event: WebviewAuthEvent,
  dependencies?: DiagnosticDependencies
) {
  const route =
    dependencies?.route ?? (typeof window === "undefined" ? undefined : window.location.pathname);
  const send =
    dependencies?.fetch ??
    (typeof window === "undefined" || typeof window.fetch !== "function"
      ? undefined
      : window.fetch.bind(window));

  if (!route || !send) return;

  try {
    void send("/api/auth-diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, route }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Diagnostics must never block sign-in help.
  }
}

function copyWithSelection(text: string, activeDocument: Document) {
  const textArea = activeDocument.createElement("textarea");
  const previouslyFocused = activeDocument.activeElement as HTMLElement | null;

  textArea.value = text;
  textArea.readOnly = true;
  textArea.setAttribute("aria-hidden", "true");
  textArea.style.position = "fixed";
  textArea.style.inset = "0 auto auto -9999px";
  textArea.style.opacity = "0";
  activeDocument.body.appendChild(textArea);

  try {
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, text.length);
    return typeof activeDocument.execCommand === "function" && activeDocument.execCommand("copy");
  } catch {
    return false;
  } finally {
    textArea.remove();
    try {
      previouslyFocused?.focus({ preventScroll: true });
    } catch {
      previouslyFocused?.focus();
    }
  }
}

/** Copies a URL with a selection fallback for webviews that omit or reject Clipboard API access. */
export async function copyTextToClipboard(text: string, dependencies?: CopyDependencies) {
  const clipboard = dependencies
    ? dependencies.clipboard
    : typeof navigator === "undefined"
      ? undefined
      : navigator.clipboard;
  const activeDocument = dependencies
    ? dependencies.document
    : typeof document === "undefined"
      ? undefined
      : document;

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Some embedded browsers expose Clipboard API but reject it. Try selection copying below.
    }
  }

  return activeDocument ? copyWithSelection(text, activeDocument) : false;
}

export function getCopyLinkFeedback(state: CopyLinkState) {
  switch (state) {
    case "copying":
      return { buttonLabel: "Copying...", statusMessage: "Copying link." };
    case "copied":
      return {
        buttonLabel: "Copied",
        statusMessage: "Link copied. Paste it into your browser to continue.",
      };
    case "failed":
      return {
        buttonLabel: "Try copying again",
        statusMessage: "Copy failed. Press and hold the URL to copy it manually.",
      };
    default:
      return { buttonLabel: "Copy link", statusMessage: "" };
  }
}

export async function runCopyLinkAction(input: {
  url: string;
  setState: (state: CopyLinkState) => void;
  copyText?: (text: string) => Promise<boolean>;
}) {
  input.setState("copying");

  let copied = false;
  try {
    copied = await (input.copyText ?? copyTextToClipboard)(input.url);
  } catch {
    copied = false;
  }

  input.setState(copied ? "copied" : "failed");
  return copied;
}

export function EmbeddedBrowserSignInFallback({
  children,
  className,
  fallbackClassName,
  wrapperClassName,
  message = DEFAULT_MESSAGE,
  externalBrowserInstructions = DEFAULT_INSTRUCTIONS,
  externalBrowserUrl,
  onCanonicalLinkCopied,
}: EmbeddedBrowserFallbackProps) {
  const [copyState, setCopyState] = useState<CopyLinkState>("idle");
  const feedback = getCopyLinkFeedback(copyState);

  async function copyLink() {
    const copied = await runCopyLinkAction({
      url: externalBrowserUrl,
      setState: setCopyState,
    });
    if (copied) {
      reportWebviewAuthEvent("webview_link_copied");
      onCanonicalLinkCopied?.();
    }
  }

  return (
    <div className={joinClassNames("auth-webview-guard", styles.guard, wrapperClassName)}>
      <span className={joinClassNames(className, "auth-webview-disabled")} aria-disabled="true">
        {children}
      </span>
      <p className={joinClassNames("meta", "auth-webview-message", styles.message)} role="status">
        {message}
      </p>
      <p className={joinClassNames("meta", styles.instructions)}>{externalBrowserInstructions}</p>
      <div className={styles.urlGroup}>
        <span className={styles.urlLabel}>Link to open</span>
        <code className={styles.url} dir="ltr">
          {externalBrowserUrl}
        </code>
      </div>
      <button
        className={joinClassNames(fallbackClassName ?? className, styles.copyButton)}
        type="button"
        onClick={() => void copyLink()}
        disabled={copyState === "copying"}
      >
        {feedback.buttonLabel}
      </button>
      <p
        className={joinClassNames("meta", styles.copyStatus)}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {feedback.statusMessage}
      </p>
    </div>
  );
}

export default function SignInLink({
  callbackUrl,
  className,
  children,
  fallbackClassName,
  wrapperClassName,
  message,
  externalBrowserInstructions,
  externalBrowserUrl,
  onWebviewHelpShown,
  onCanonicalLinkCopied,
}: SignInLinkProps) {
  const [browserState, setBrowserState] = useState({
    blocked: false,
    currentUrl: externalBrowserUrl ?? callbackUrl,
  });
  const helpShownCallback = useRef(onWebviewHelpShown);
  const didReportHelp = useRef(false);

  useEffect(() => {
    helpShownCallback.current = onWebviewHelpShown;
  }, [onWebviewHelpShown]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const blocked = isInAppBrowser(window.navigator.userAgent);
      setBrowserState({
        blocked,
        currentUrl:
          externalBrowserUrl ?? `${window.location.origin}${window.location.pathname}`,
      });

      if (blocked && !didReportHelp.current) {
        didReportHelp.current = true;
        reportWebviewAuthEvent("webview_help_shown");
        helpShownCallback.current?.();
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [callbackUrl, externalBrowserUrl]);

  const signInHref = `/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  if (!browserState.blocked) {
    return (
      <a className={className} href={signInHref}>
        {children}
      </a>
    );
  }

  return (
    <EmbeddedBrowserSignInFallback
      className={className}
      fallbackClassName={fallbackClassName}
      wrapperClassName={wrapperClassName}
      message={message}
      externalBrowserInstructions={externalBrowserInstructions}
      externalBrowserUrl={browserState.currentUrl}
      onCanonicalLinkCopied={onCanonicalLinkCopied}
    >
      {children}
    </EmbeddedBrowserSignInFallback>
  );
}
