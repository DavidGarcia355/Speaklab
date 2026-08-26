import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_IDENTITY_SCRIPT_URL,
  GoogleDriveExportError,
} from "@/lib/google-drive/export";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  scope?: string;
};

type GoogleTokenClient = {
  requestAccessToken(options?: { prompt?: string }): void;
};

type GoogleTokenClientConfig = {
  client_id: string;
  scope: string;
  include_granted_scopes: boolean;
  callback(response: GoogleTokenResponse): void;
  error_callback(error: { type?: string }): void;
};

type GoogleIdentityApi = {
  accounts: {
    oauth2: {
      initTokenClient(config: GoogleTokenClientConfig): GoogleTokenClient;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}

let scriptPromise: Promise<void> | null = null;
const GOOGLE_IDENTITY_LOAD_TIMEOUT_MS = 10_000;

export function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(
      new GoogleDriveExportError("configuration", "Google Drive export requires a web browser."),
    );
  }
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`,
    );
    const script = existing ?? document.createElement("script");
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      callback();
    };
    const onLoad = () => {
      if (window.google?.accounts?.oauth2) {
        finish(resolve);
      } else {
        finish(() => {
          scriptPromise = null;
          reject(new GoogleDriveExportError("configuration", "Google sign-in did not finish loading."));
        });
      }
    };
    const onError = () => {
      finish(() => {
        scriptPromise = null;
        reject(
          new GoogleDriveExportError(
            "network",
            "Could not load Google Drive sign-in. Check your connection and try again.",
          ),
        );
      });
    };
    const timeoutId = window.setTimeout(() => {
      finish(() => {
        scriptPromise = null;
        reject(
          new GoogleDriveExportError(
            "network",
            "Google Drive sign-in took too long to load. Check your connection and try again.",
          ),
        );
      });
    }, GOOGLE_IDENTITY_LOAD_TIMEOUT_MS);
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.referrerPolicy = "strict-origin-when-cross-origin";
      document.head.appendChild(script);
    }
  });
  return scriptPromise;
}

function cancellationMessage(error: string) {
  return error === "access_denied" || error === "popup_closed";
}

export async function requestGoogleDriveAccessToken(clientId: string): Promise<string> {
  const cleanedClientId = clientId.trim();
  if (!cleanedClientId) {
    throw new GoogleDriveExportError("configuration", "Google Drive export is not configured.");
  }
  await loadGoogleIdentityServices();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new GoogleDriveExportError("configuration", "Google sign-in is unavailable in this browser.");
  }

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: cleanedClientId,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      // Keep the export token limited to the scope requested by this action,
      // even if this OAuth client has other grants from a separate flow.
      include_granted_scopes: false,
      callback(response) {
        if (response.error) {
          reject(
            new GoogleDriveExportError(
              cancellationMessage(response.error) ? "cancelled" : "authorization",
              cancellationMessage(response.error)
                ? "Google Drive export canceled. Nothing was uploaded."
                : "Google Drive did not grant file access. Reconnect and try again.",
            ),
          );
          return;
        }
        const scopes = (response.scope ?? "").split(/\s+/).filter(Boolean);
        if (!scopes.includes(GOOGLE_DRIVE_FILE_SCOPE)) {
          reject(
            new GoogleDriveExportError(
              "authorization",
              "Google Drive file access was not granted. Reconnect and approve file access.",
            ),
          );
          return;
        }
        const accessToken = response.access_token?.trim() ?? "";
        if (!accessToken) {
          reject(new GoogleDriveExportError("authorization", "Google Drive did not return access. Reconnect and try again."));
          return;
        }
        resolve(accessToken);
      },
      error_callback(error) {
        const type = error.type ?? "";
        reject(
          new GoogleDriveExportError(
            cancellationMessage(type) ? "cancelled" : "authorization",
            cancellationMessage(type)
              ? "Google Drive export canceled. Nothing was uploaded."
              : "Google Drive sign-in could not open. Allow pop-ups and try again.",
          ),
        );
      },
    });
    // GIS decides whether consent or account selection is needed. Calling this
    // only from the export button preserves user intent without forcing a
    // repetitive consent screen for teachers who already granted drive.file.
    client.requestAccessToken();
  });
}

export function resetGoogleIdentityLoaderForTests() {
  scriptPromise = null;
}
