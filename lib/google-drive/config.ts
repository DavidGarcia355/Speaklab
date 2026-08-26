import "server-only";

export type GoogleDrivePublicConfig = {
  enabled: boolean;
  clientId: string;
};

/**
 * Returns the only Google Drive configuration that is safe to expose to the
 * browser. An OAuth client ID is public; the matching client secret must never
 * be returned by this function or sent to the browser.
 */
export function getGoogleDrivePublicConfig(): GoogleDrivePublicConfig {
  const clientId = process.env.AUTH_GOOGLE_ID?.trim() ?? "";
  return {
    enabled: process.env.GOOGLE_DRIVE_EXPORT_ENABLED === "true" && clientId.length > 0,
    clientId,
  };
}
