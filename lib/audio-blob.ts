import "server-only";

/** Private media storage used for student recordings and teacher worksheets. */
export function getPrivateBlobCommandOptions() {
  const storeId = process.env.AUDIO_BLOB_STORE_ID?.trim();
  if (!storeId) {
    throw new Error("AUDIO_BLOB_STORE_ID is required for private audio storage.");
  }

  // Vercel functions authenticate with their short-lived project OIDC token.
  // The prefixed static token is retained only for explicit off-Vercel/local use.
  const localToken =
    process.env.VERCEL === "1" ? "" : process.env.AUDIO_READ_WRITE_TOKEN?.trim() || "";

  return {
    storeId,
    ...(localToken ? { token: localToken } : {}),
  };
}

/** Backward-compatible name retained for the existing audio call sites. */
export const getAudioBlobCommandOptions = getPrivateBlobCommandOptions;
