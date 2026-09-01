"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type UndoToastProps = {
  message: string;
  expiresAt: number;
  onUndo: () => void;
  onDismiss: () => void;
};

const WINDOW_MS = 5000;

export default function UndoToast({ message, expiresAt, onUndo, onDismiss }: UndoToastProps) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, expiresAt - Date.now()));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingMs(Math.max(0, expiresAt - Date.now()));
    }, 100);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const percent = useMemo(() => Math.max(0, Math.min(100, (remainingMs / WINDOW_MS) * 100)), [remainingMs]);
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const portalTarget = typeof document === "undefined" ? null : document.body;

  if (!portalTarget) return null;

  return createPortal(
    <div className="undo-toast" role="status" aria-live="polite">
      <div className="undo-toast-row">
        <p className="undo-toast-message">{message}</p>
        <button type="button" className="btn btn-ghost" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <div className="undo-toast-actions">
        <button type="button" className="btn btn-ghost" onClick={onUndo}>
          Undo ({seconds}s)
        </button>
      </div>
      <div className="undo-progress">
        <div className="undo-progress-bar" style={{ width: `${percent}%` }} />
      </div>
    </div>,
    portalTarget
  );
}
