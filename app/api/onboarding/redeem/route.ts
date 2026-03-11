import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApiHandler(request, async () => {
    return NextResponse.json(
      { error: "Teacher access is automatic now. Sign in with Google to continue." },
      { status: 410 }
    );
  });
}
