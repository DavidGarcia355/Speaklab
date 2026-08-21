import "server-only";

/**
 * Student recordings live in a dedicated private store. Requiring its ID on
 * every command prevents the Blob SDK from falling back to the public
 * assignment-attachment store.
 */
export function getAudioBlobCommandOptions() {
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
