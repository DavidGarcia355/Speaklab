import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/http";
import { assertAiProviderConfig, getAiConfig, isLocalMockAi } from "@/lib/ai/config";
import {
  assertGradingProviderConfiguration,
  getGradingConfig,
} from "@/lib/grading/config";
import { getGoogleDrivePublicConfig } from "@/lib/google-drive/config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    const config = getAiConfig();
    let aiReady = config.enabled;
    if (aiReady) {
      try {
        assertAiProviderConfig(config);
        assertGradingProviderConfiguration(getGradingConfig());
      } catch {
        aiReady = false;
      }
    }

    const driveConfig = getGoogleDrivePublicConfig();

    return NextResponse.json({
      aiGradingEnabled: aiReady,
      aiBulkGradingEnabled: aiReady && config.bulkEnabled,
      localAiTestMode: isLocalMockAi(config),
      localAuthBypassEnabled:
        process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_BYPASS_AUTH === "true",
      googleDriveExport: driveConfig.enabled
        ? driveConfig
        : { enabled: false, clientId: "" },
    });
  });
}
