"use client";

import { useEffect, useState } from "react";
import { CloudUpload } from "lucide-react";
import {
  exportSubmissionToGoogleDrive,
  fetchGoogleDrivePublicConfig,
  googleDriveErrorMessage,
  isGoogleDriveReconnectError,
  type GoogleDrivePublicClientConfig,
} from "@/lib/google-drive/export";
import {
  loadGoogleIdentityServices,
  requestGoogleDriveAccessToken,
} from "@/lib/google-drive/google-identity";

type GoogleDriveExportButtonProps = {
  submissionId: string;
  studentName: string;
  filenameBase: string;
  includeTranscript?: boolean;
};

type ExportPhase = "loading" | "ready" | "connecting" | "exporting" | "success" | "error";

export default function GoogleDriveExportButton({
  submissionId,
  studentName,
  filenameBase,
  includeTranscript = true,
}: GoogleDriveExportButtonProps) {
  const [config, setConfig] = useState<GoogleDrivePublicClientConfig | null>(null);
  const [phase, setPhase] = useState<ExportPhase>("loading");
  const [message, setMessage] = useState("");
  const [folderUrl, setFolderUrl] = useState("");
  const [needsReconnect, setNeedsReconnect] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchGoogleDrivePublicConfig()
      .then((nextConfig) => {
        if (!active) return;
        setConfig(nextConfig);
        if (!nextConfig.enabled) {
          setPhase("error");
          setMessage("Google Drive export is not available right now.");
          return;
        }
        setPhase("ready");
        // Loading Google's script does not request account access. The OAuth
        // prompt remains strictly tied to the teacher clicking the button.
        void loadGoogleIdentityServices().catch(() => undefined);
      })
      .catch((error) => {
        if (!active) return;
        setPhase("error");
        setMessage(googleDriveErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleExport() {
    if (!config?.enabled || phase === "connecting" || phase === "exporting") return;
    setPhase("connecting");
    setMessage("Choose the Google account where you want to save this portfolio.");
    setFolderUrl("");
    setNeedsReconnect(false);
    let accessToken = "";
    try {
      accessToken = await requestGoogleDriveAccessToken(config.clientId);
      setPhase("exporting");
      setMessage(
        includeTranscript
          ? "Saving the clean transcript and original recording to Google Drive..."
          : "Saving the original recording to Google Drive...",
      );
      const result = await exportSubmissionToGoogleDrive({
        accessToken,
        submissionId,
        studentName,
        filenameBase,
        includeTranscript,
      });
      setFolderUrl(result.folderUrl);
      setPhase("success");
      setMessage(
        includeTranscript
          ? "Transcript and original recording saved to Google Drive."
          : "Original recording saved to Google Drive.",
      );
    } catch (error) {
      setPhase("error");
      setNeedsReconnect(isGoogleDriveReconnectError(error));
      setMessage(googleDriveErrorMessage(error));
    } finally {
      accessToken = "";
    }
  }

  // The parent also gates this control server-side, but this client-side guard
  // keeps a stale or failed feature response from exposing a broken button.
  if (!config?.enabled) return null;

  const busy = phase === "connecting" || phase === "exporting";
  const buttonLabel =
    phase === "connecting"
      ? "Connecting to Google Drive..."
        : phase === "exporting"
          ? "Saving to Google Drive..."
          : needsReconnect
            ? "Reconnect Google Drive and retry"
            : includeTranscript
              ? "Save transcript + recording to Google Drive"
              : "Save recording to Google Drive";

  return (
    <div className="google-drive-export">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => void handleExport()}
        disabled={busy}
      >
        <CloudUpload size={15} aria-hidden="true" /> {buttonLabel}
      </button>
      {message ? (
        <p
          className={phase === "error" ? "card-inline-error" : "meta"}
          role={phase === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {message}{" "}
          {phase === "success" && folderUrl ? (
            <a href={folderUrl} target="_blank" rel="noopener noreferrer">
              Open TryHabla Oral Portfolios
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
