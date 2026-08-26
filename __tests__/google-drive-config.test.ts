import { afterEach, describe, expect, it } from "vitest";
import { getGoogleDrivePublicConfig } from "@/lib/google-drive/config";

const originalEnabled = process.env.GOOGLE_DRIVE_EXPORT_ENABLED;
const originalClientId = process.env.AUTH_GOOGLE_ID;
const originalClientSecret = process.env.AUTH_GOOGLE_SECRET;

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.GOOGLE_DRIVE_EXPORT_ENABLED;
  else process.env.GOOGLE_DRIVE_EXPORT_ENABLED = originalEnabled;
  if (originalClientId === undefined) delete process.env.AUTH_GOOGLE_ID;
  else process.env.AUTH_GOOGLE_ID = originalClientId;
  if (originalClientSecret === undefined) delete process.env.AUTH_GOOGLE_SECRET;
  else process.env.AUTH_GOOGLE_SECRET = originalClientSecret;
});

describe("Google Drive public configuration", () => {
  it("fails closed unless the flag is exactly true and a client ID is present", () => {
    process.env.AUTH_GOOGLE_ID = "google-client.apps.googleusercontent.com";
    process.env.GOOGLE_DRIVE_EXPORT_ENABLED = "TRUE";
    expect(getGoogleDrivePublicConfig()).toEqual({
      enabled: false,
      clientId: "google-client.apps.googleusercontent.com",
    });

    process.env.GOOGLE_DRIVE_EXPORT_ENABLED = "true";
    process.env.AUTH_GOOGLE_ID = "   ";
    expect(getGoogleDrivePublicConfig()).toEqual({ enabled: false, clientId: "" });
  });

  it("exposes only the non-secret browser client ID when enabled", () => {
    process.env.GOOGLE_DRIVE_EXPORT_ENABLED = "true";
    process.env.AUTH_GOOGLE_ID = "  google-client.apps.googleusercontent.com  ";
    process.env.AUTH_GOOGLE_SECRET = "must-not-be-exposed";

    const config = getGoogleDrivePublicConfig();
    expect(config).toEqual({
      enabled: true,
      clientId: "google-client.apps.googleusercontent.com",
    });
    expect(JSON.stringify(config)).not.toContain("must-not-be-exposed");
  });
});
